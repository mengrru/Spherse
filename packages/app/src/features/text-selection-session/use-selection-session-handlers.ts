import { useCallback, useMemo } from "react";
import { useMatch, useNavigate } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";
import type { ActiveSessionInfo, AgentSummary, SessionInfo } from "../../lib/types";
import { createProjectSession, useProjectCatalog } from "../../queries/project";
import { useFloatingSessionId } from "../floating-chat";

type Translate = ReturnType<typeof useI18n>["t"];

export function buildSelectionPrompt(
  t: Translate,
  selectedText: string,
  sourcePath: string,
  comment?: string,
): string {
  const quotedText = selectedText.split("\n").map((line) => `> ${line}`).join("\n");
  const parts = [t("text-selection.promptPrefix", { path: sourcePath, text: quotedText })];
  if (comment) parts.push(`\n\n${comment}`);
  return parts.join("");
}

function toActiveSession(
  sessionId: string | null,
  sessions: SessionInfo[],
  agents: AgentSummary[],
  floating: boolean,
): ActiveSessionInfo | null {
  if (!sessionId) return null;
  const session = sessions.find((s) => s.id === sessionId);
  const agent = session ? agents.find((a) => a.id === session.agentId) : undefined;
  if (!session || !agent) return null;
  return { sessionId: session.id, agentName: agent.name, sessionTitle: session.title, floating };
}

export function useSelectionSessionHandlers() {
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const navigate = useNavigate();
  const { t } = useI18n();
  const { agents, sessions } = useProjectCatalog(projectId, client);
  const floatingSessionId = useFloatingSessionId(projectId);
  const routeSessionId = useMatch("/project/:projectId/chat/:sessionId")?.params.sessionId ?? null;

  const activeSessions = useMemo(() => {
    const result: ActiveSessionInfo[] = [];
    const current = toActiveSession(routeSessionId, sessions, agents, false);
    if (current) result.push(current);
    const floating = toActiveSession(floatingSessionId, sessions, agents, true);
    if (floating && floating.sessionId !== current?.sessionId) result.push(floating);
    return result;
  }, [routeSessionId, floatingSessionId, sessions, agents]);

  const onStartSession = useCallback(async (
    agentId: string,
    selectedText: string,
    sourcePath: string,
    comment?: string,
  ) => {
    if (!client) return;
    const message = buildSelectionPrompt(t, selectedText, sourcePath, comment);
    const session = await createProjectSession(projectId, client, agentId, message).catch(() => null);
    if (session) navigate(`/project/${projectId}/chat/${session.id}`);
  }, [client, navigate, projectId, t]);

  return { agents, activeSessions, onStartSession };
}
