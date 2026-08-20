import { EventEmitter } from "node:events";
import type { SessionPort } from "../kernel/ports.js";
import type { TriggerStore } from "../store/trigger.js";
import type { TriggerEntry, TriggerLogEntry } from "../types.js";
import { type Logger, createSilentLogger } from "../logger.js";
import { resolveTemplateVars } from "./template.js";

export interface TriggerExecutorDeps {
  session: SessionPort;
  getTriggerStore(agentId: string): TriggerStore | null;
  logger?: Logger;
}

export class TriggerExecutor extends EventEmitter {
  private readonly inProgress = new Set<string>();
  private readonly logger: Logger;

  constructor(private readonly deps: TriggerExecutorDeps) {
    super();
    this.logger = deps.logger ?? createSilentLogger();
  }

  isRunning(triggerId: string): boolean {
    return this.inProgress.has(triggerId);
  }

  forgetAll(): void {
    this.inProgress.clear();
  }

  async fire(
    entry: TriggerEntry,
    agentId: string,
    agentName: string,
    payload: string,
    eventName?: string,
  ): Promise<void> {
    if (this.inProgress.has(entry.id)) return;
    this.inProgress.add(entry.id);

    const now = Date.now();
    const triggerName = entry.name || (entry.type === "time" ? entry.cron! : entry.eventName!);

    const logEntry: TriggerLogEntry = {
      triggerId: entry.id,
      triggerName,
      agentName,
      eventName,
      sessionId: "",
      triggeredAt: now,
      status: "running",
    };

    this.emit("trigger_triggered", { agentId, triggerId: entry.id, eventName, triggeredAt: now });

    try {
      let sessionId: string;

      switch (entry.mode) {
        case "new_session": {
          sessionId = await this.deps.session.createSession(agentId, "triggered");
          break;
        }
        case "existing_session": {
          if (!entry.targetSessionId) {
            const err = "existing_session mode but no targetSessionId";
            this.logger.error({ triggerId: entry.id }, err);
            throw new Error(err);
          }
          sessionId = entry.targetSessionId;
          await this.deps.session.restoreSession(agentId, sessionId);
          break;
        }
        case "reusable_session": {
          const bound = entry.boundSessionId;
          if (bound && this.deps.session.sessionExists(agentId, bound)) {
            sessionId = bound;
            await this.deps.session.restoreSession(agentId, sessionId);
          } else {
            sessionId = await this.deps.session.createSession(agentId, "triggered");
            this.deps.getTriggerStore(agentId)?.update(entry.id, { boundSessionId: sessionId });
          }
          break;
        }
        default: {
          const err = `unknown trigger mode: ${(entry as TriggerEntry).mode}`;
          this.logger.error({ triggerId: entry.id }, err);
          throw new Error(err);
        }
      }

      logEntry.sessionId = sessionId;
      this.deps.getTriggerStore(agentId)?.appendLog(logEntry);

      const resolvedMessage = resolveTemplateVars(entry.message, { agentName, payload });

      await this.deps.session.sendMessage(sessionId, resolvedMessage, (event) => {
        if (event.type === "agent_end") {
          this.deps.getTriggerStore(agentId)?.appendLog({
            ...logEntry,
            completedAt: Date.now(),
            status: "success",
          });
          this.emit("trigger_completed", {
            agentId,
            triggerId: entry.id,
            sessionId,
            status: "success",
          });
        }
      });
    } catch (err) {
      this.deps.getTriggerStore(agentId)?.appendLog({
        ...logEntry,
        completedAt: Date.now(),
        status: "failed",
        error: String(err),
      });
      this.emit("trigger_failed", {
        agentId,
        triggerId: entry.id,
        error: String(err),
      });
    } finally {
      this.inProgress.delete(entry.id);
    }
  }
}
