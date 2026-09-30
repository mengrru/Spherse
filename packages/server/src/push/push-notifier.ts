import type { Logger, SessionEvent, SessionManager, TriggerEntry, TriggerEventPayload } from "@spherse/core";
import { normalizeLocale, translate } from "@spherse/i18n";
import webpush from "web-push";
import type { PushNotificationPayload } from "@spherse/contracts";
import type { ProjectContextCompat } from "../registry.js";
import type { PushStore, PushSubscriptionRecord } from "./push-store.js";

const VAPID_SUBJECT = "https://spherse.app";

interface ProjectAttachment {
  detach: () => void;
}

export class PushNotifier {
  private readonly attachments = new Map<SessionManager, ProjectAttachment>();
  private readonly store: PushStore;
  private readonly logger: Logger | { warn(obj: unknown, msg?: string): void };
  private closed = false;

  constructor(deps: { store: PushStore; logger: Logger | { warn(obj: unknown, msg?: string): void } }) {
    this.store = deps.store;
    this.logger = deps.logger;
    const vapid = this.store.getVapid();
    webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);
  }

  attachProject(ctx: ProjectContextCompat): void {
    if (this.closed) return;
    if (this.attachments.has(ctx.sessionRuntime)) return;

    const detachSessionEvents = ctx.sessionRuntime.onSessionEvent((event, sctx) => {
      this.handleSessionEvent(ctx, event, sctx.agentId, sctx.sessionId);
    });

    const onTriggerEvent = (type: "trigger_completed" | "trigger_failed", payload: TriggerEventPayload) => {
      void this.handleTriggerEvent(ctx, type, payload);
    };
    const completedHandler = (payload: TriggerEventPayload) => onTriggerEvent("trigger_completed", payload);
    const failedHandler = (payload: TriggerEventPayload) => onTriggerEvent("trigger_failed", payload);
    ctx.triggerManager.on("trigger_completed", completedHandler);
    ctx.triggerManager.on("trigger_failed", failedHandler);

    this.attachments.set(ctx.sessionRuntime, {
      detach: () => {
        detachSessionEvents();
        ctx.triggerManager.off("trigger_completed", completedHandler);
        ctx.triggerManager.off("trigger_failed", failedHandler);
      },
    });
  }

  detachProject(runtime: SessionManager): void {
    this.attachments.get(runtime)?.detach();
    this.attachments.delete(runtime);
  }

  close(): void {
    this.closed = true;
    for (const attachment of this.attachments.values()) {
      attachment.detach();
    }
    this.attachments.clear();
  }

  private handleSessionEvent(
    ctx: ProjectContextCompat,
    event: SessionEvent,
    agentId: string,
    sessionId: string,
  ): void {
    if (event.type !== "control/requested") return;
    const { requestId, kind, toolName } = event.data;
    const agentName = ctx.projectManager.getAgentProfile(agentId)?.name;
    void this.dispatch((sub) => {
      const locale = normalizeLocale(sub.locale);
      const titleKey =
        kind === "question"
          ? agentName
            ? "push.questionTitleWithName"
            : "push.questionTitle"
          : agentName
            ? "push.approvalTitleWithName"
            : "push.approvalTitle";
      const bodyKey = kind === "question" ? "push.questionBody" : "push.approvalBody";
      return {
        title: translate(locale, titleKey, agentName ? { name: agentName } : undefined),
        body: translate(locale, bodyKey, { tool: toolName }),
        tag: `approval:${requestId}`,
        data: { kind: "approval", projectId: ctx.projectId, sessionId },
      };
    });
  }

  private async handleTriggerEvent(
    ctx: ProjectContextCompat,
    type: "trigger_completed" | "trigger_failed",
    payload: TriggerEventPayload,
  ): Promise<void> {
    const entry: TriggerEntry | null =
      payload.trigger ?? ctx.triggerManager.get(payload.agentId, payload.triggerId) ?? null;
    if (!entry?.notify) return;
    const triggerName = entry.name || (entry.type === "time" ? entry.cron! : entry.eventName!);
    const sessionId = payload.sessionId || undefined;
    await this.dispatch((sub) => {
      const locale = normalizeLocale(sub.locale);
      if (type === "trigger_completed") {
        return {
          title: translate(locale, "push.triggerCompletedTitle", { name: triggerName }),
          body: entry.notificationMessage?.trim() || translate(locale, "push.triggerCompletedBody"),
          tag: `trigger:${entry.id}:${Date.now()}`,
          data: { kind: "trigger_completed", projectId: ctx.projectId, sessionId },
        };
      }
      return {
        title: translate(locale, "push.triggerFailedTitle", { name: triggerName }),
        body: translate(locale, "push.triggerFailedBody"),
        tag: `trigger:${entry.id}:${Date.now()}`,
        data: { kind: "trigger_failed", projectId: ctx.projectId, sessionId },
      };
    });
  }

  private async dispatch(build: (sub: PushSubscriptionRecord) => PushNotificationPayload): Promise<void> {
    const subscriptions = this.store.list();
    if (subscriptions.length === 0) return;
    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify(build(sub)),
          );
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            this.store.remove(sub.endpoint);
            return;
          }
          this.logger.warn(
            { endpointOrigin: endpointOrigin(sub.endpoint), statusCode },
            "push notification delivery failed",
          );
        }
      }),
    );
  }
}

function endpointOrigin(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    return "invalid-endpoint";
  }
}
