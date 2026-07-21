import { isFeatureEnabled } from "../../lib/feature-registry";
import { useFloatingChatStore } from "../../features/floating-chat/store";
import { getDefaultFloatingState } from "../../features/floating-chat";
import type { ActionContext } from "../types";

export function openChat(
  ctx: ActionContext,
  sessionId: string,
  float: boolean | undefined,
): void {
  const floatingEnabled = isFeatureEnabled("floating-chat", ctx.hostKind);
  const currentFloating = useFloatingChatStore.getState().byProject[ctx.projectId]?.sessionId;
  if (float && floatingEnabled) {
    if (currentFloating !== sessionId) {
      useFloatingChatStore.getState().setFloatingChat(ctx.projectId, getDefaultFloatingState(sessionId));
    }
    return;
  }
  if (currentFloating !== sessionId) {
    ctx.navigate(`/project/${ctx.projectId}/chat/${sessionId}`);
  }
}
