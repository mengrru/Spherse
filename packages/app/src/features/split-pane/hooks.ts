import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";
import { useProjectCtx } from "../../context/project-context";
import { useIsMobile } from "../../hooks/use-mobile";
import type { NavState } from "../../lib/nav-state";
import { projectHomeUrl, tabKey } from "../../lib/tab-target";
import { useFeature } from "../../lib/use-feature";
import { useCloseActiveTab, useRouteTabTarget } from "../tabs";
import { useSplitPaneStore } from "./store";
import { toSplitTarget, type SplitTarget } from "./target";

export function useSplitPaneAvailable(): boolean {
  const enabled = useFeature("content-split-pane");
  const isMobile = useIsMobile();
  return enabled && !isMobile;
}

export function useSplitTarget(): SplitTarget | null {
  const { projectId } = useProjectCtx();
  return useSplitPaneStore((s) => s.byProject[projectId]?.target ?? null);
}

export function useCloseSplit(): () => void {
  const { projectId } = useProjectCtx();
  return useCallback(() => useSplitPaneStore.getState().closeSplit(projectId), [projectId]);
}

export function useCloseDeletedSplit(): (path: string) => void {
  const { projectId } = useProjectCtx();
  return useCallback((path: string) => useSplitPaneStore.getState().closeDeletedSplit(projectId, path), [projectId]);
}

export function useOpenSplit(): (target: SplitTarget) => void {
  const { projectId } = useProjectCtx();
  const navigate = useNavigate();
  const location = useLocation();
  const routeTarget = useRouteTabTarget();
  const closeActiveTab = useCloseActiveTab();
  const currentUrl = location.pathname + location.search;

  return useCallback((rawTarget: SplitTarget) => {
    const target = toSplitTarget(rawTarget);
    if (!target) return;
    if (!routeTarget || tabKey(routeTarget) !== tabKey(target)) {
      useSplitPaneStore.getState().openSplit(projectId, target);
      return;
    }
    const state: NavState = { openSplit: target };
    closeActiveTab(() => {
      navigate(projectHomeUrl(projectId), { replace: true, state: { ...state, closedUrl: currentUrl } });
    }, state);
  }, [closeActiveTab, currentUrl, navigate, projectId, routeTarget]);
}
