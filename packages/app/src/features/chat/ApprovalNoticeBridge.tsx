import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useMatch, useNavigate } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { collectPendingApprovals } from "./model/approval-notice";
import { useStreamingStore } from "./runtime/streaming-store";
import { useProjectDataStore } from "../../stores/project-data-store";

export function ApprovalNoticeBridge() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const match = useMatch("/project/:projectId/chat/:sessionId");
  const activeSessionId = match?.params.sessionId ?? null;

  const notifiedRef = useRef<Set<string>>(new Set());
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    const check = () => {
      const pending = collectPendingApprovals(useStreamingStore.getState().sessions);
      const pendingIds = new Set(pending.map((item) => item.requestId));
      notifiedRef.current = new Set([...notifiedRef.current].filter((id) => pendingIds.has(id)));
      for (const item of pending) {
        if (notifiedRef.current.has(item.requestId)) continue;
        if (item.sessionId === activeSessionId) continue;
        notifiedRef.current.add(item.requestId);
        const project = useProjectDataStore.getState().projects[item.projectId];
        const session = project?.sessions.find((s) => s.id === item.sessionId);
        const agent = session ? project?.agents.find((a) => a.id === session.agentId) : undefined;
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
      }
    };
    check();
    const unsubscribe = useStreamingStore.subscribe(check);
    return unsubscribe;
  }, [navigate, activeSessionId]);

  return null;
}
