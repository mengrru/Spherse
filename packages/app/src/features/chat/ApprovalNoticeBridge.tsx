import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useMatch, useNavigate } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { useChatSessionStore } from "./runtime/session-store";
import { assembleGroups } from "./model/message-group";
import { collectPendingControls } from "./model/group-derivations";
import type { ChatSessionState } from "./runtime/session-state";
import { getCachedAgents, getCachedSession } from "../../queries/project";
import { useSettingsStore } from "../../stores/settings-store";
import { useHostBridge } from "../../context/host-bridge-context";

interface PendingApproval {
  kind: "approval" | "question";
  requestId: string;
  sessionId: string;
  projectId: string;
  toolName: string;
  command?: string;
}

function collectPendingApprovals(
  sessions: Record<string, ChatSessionState>,
): PendingApproval[] {
  const result: PendingApproval[] = [];
  for (const session of Object.values(sessions)) {
    for (const control of collectPendingControls(assembleGroups(session.entries))) {
      result.push({
        ...control,
        sessionId: session.sessionId,
        projectId: session.projectId,
      });
    }
  }
  return result;
}

export function ApprovalNoticeBridge() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const bridge = useHostBridge();
  const match = useMatch("/project/:projectId/chat/:sessionId");
  const activeSessionId = match?.params.sessionId ?? null;

  const notifiedRef = useRef<Set<string>>(new Set());
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    const check = () => {
      const state = useChatSessionStore.getState().sessions;
      const settings = useSettingsStore.getState();
      const systemNoticeAllowed =
        settings.systemNotifications && !document.hasFocus() && Boolean(bridge.notifications);
      const pending = collectPendingApprovals(state);
      const pendingIds = new Set(pending.map((item) => item.requestId));
      notifiedRef.current = new Set([...notifiedRef.current].filter((id) => pendingIds.has(id)));
      for (const item of pending) {
        if (notifiedRef.current.has(item.requestId)) continue;
        if (item.sessionId === activeSessionId) continue;
        notifiedRef.current.add(item.requestId);
        const session = getCachedSession(item.projectId, item.sessionId);
        const agent = session
          ? getCachedAgents(item.projectId).find((candidate) => candidate.id === session.agentId)
          : undefined;
        const title =
          item.kind === "question"
            ? agent?.name
              ? tRef.current("chat.questionToastMessageWithName", { name: agent.name })
              : tRef.current("chat.questionToastMessage")
            : agent?.name
              ? tRef.current("chat.approvalToastMessageWithName", { name: agent.name })
              : tRef.current("chat.approvalToastMessage");
        toast.success(title, {
          action: {
            label: tRef.current("chat.approvalToastAction"),
            onClick: () => navigate(`/project/${item.projectId}/chat/${item.sessionId}`),
          },
        });
        if (systemNoticeAllowed) {
          bridge.notifications?.show({
            title,
            body: tRef.current("push.approvalBody", { tool: item.toolName }),
          });
        }
      }
    };
    check();
    const unsubscribe = useChatSessionStore.subscribe(check);
    return unsubscribe;
  }, [navigate, activeSessionId, bridge]);

  return null;
}
