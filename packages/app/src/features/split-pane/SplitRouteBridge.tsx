import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useProjectCtx } from "../../context/project-context";
import { hasTabNavState, readNavState } from "../../lib/nav-state";
import { dropFromProjectNavHistory } from "../../lib/use-project-navigation";
import { useTabsEnabled } from "../tabs";
import { useSplitPaneStore } from "./store";

export function SplitRouteBridge() {
  const { projectId } = useProjectCtx();
  const location = useLocation();
  const navigate = useNavigate();
  const tabsEnabled = useTabsEnabled();

  useEffect(() => {
    const nav = readNavState(location.state);
    if (!nav.openSplit) return;
    useSplitPaneStore.getState().openSplit(projectId, nav.openSplit);
    if (nav.closedUrl) dropFromProjectNavHistory(projectId, nav.closedUrl);
    if (tabsEnabled && hasTabNavState(nav)) return;
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: null },
    );
  }, [location, navigate, projectId, tabsEnabled]);

  return null;
}
