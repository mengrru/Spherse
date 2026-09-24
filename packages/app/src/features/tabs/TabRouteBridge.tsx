import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useProjectCtx } from "../../context/project-context";
import { useTabsStore } from "./store";
import { dropFromProjectNavHistory } from "../../lib/use-project-navigation";
import { hasTabNavState, readNavState } from "../../lib/nav-state";
import { tabKey } from "../../lib/tab-target";
import { useFloatingSessionId } from "../floating-chat/use-floating-session-id";
import { useRouteTabTarget } from "./use-route-tab";
import { useTabsEnabled } from "./use-tabs-enabled";

export function TabRouteBridge() {
  const { projectId } = useProjectCtx();
  const enabled = useTabsEnabled();
  const location = useLocation();
  const navigate = useNavigate();
  const target = useRouteTabTarget();
  const floatingSessionId = useFloatingSessionId(projectId);

  useEffect(() => {
    if (!enabled) return;
    const store = useTabsStore.getState();
    const nav = readNavState(location.state);
    if (nav.closeTab) store.closeTab(projectId, nav.closeTab);
    if (nav.closedUrl) dropFromProjectNavHistory(projectId, nav.closedUrl);
    if (target && !(target.kind === "chat" && target.sessionId === floatingSessionId)) {
      if (nav.replaceTab) store.replaceTab(projectId, nav.replaceTab, target);
      else store.openTab(projectId, target);
    }
    if (hasTabNavState(nav)) {
      navigate(
        { pathname: location.pathname, search: location.search, hash: location.hash },
        { replace: true, state: null },
      );
    }
  }, [enabled, floatingSessionId, location, navigate, projectId, target]);

  useEffect(() => {
    if (!enabled || !floatingSessionId) return;
    useTabsStore.getState().closeTab(projectId, tabKey({ kind: "chat", sessionId: floatingSessionId }));
  }, [enabled, floatingSessionId, projectId]);

  return null;
}
