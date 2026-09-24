import { useCallback } from "react";
import { useLocation, useMatch, useNavigate, useSearchParams } from "react-router";
import { useProjectCtx } from "../../context/project-context";
import { useIsMobile } from "../../hooks/use-mobile";
import type { NavState } from "../../lib/nav-state";
import { projectHomeUrl, tabKey } from "../../lib/tab-target";
import { useFeature } from "../../lib/use-feature";
import { useCloseActiveTab } from "../tabs";
import { useSplitPaneStore } from "./store";

function sameFile(a: string, b: string): boolean {
  return tabKey({ kind: "file", path: a }) === tabKey({ kind: "file", path: b });
}

export function useSplitPaneAvailable(): boolean {
  const enabled = useFeature("content-split-pane");
  const isMobile = useIsMobile();
  return enabled && !isMobile;
}

export function useSplitFilePath(): string | null {
  const { projectId } = useProjectCtx();
  return useSplitPaneStore((s) => s.byProject[projectId]?.filePath ?? null);
}

export function useCloseSplit(): () => void {
  const { projectId } = useProjectCtx();
  return useCallback(() => useSplitPaneStore.getState().closeSplit(projectId), [projectId]);
}

export function useCloseDeletedSplit(): (path: string) => void {
  const { projectId } = useProjectCtx();
  return useCallback((path: string) => useSplitPaneStore.getState().closeDeletedSplit(projectId, path), [projectId]);
}

export function useOpenSplit(): (filePath: string) => void {
  const { projectId } = useProjectCtx();
  const navigate = useNavigate();
  const location = useLocation();
  const contentMatch = useMatch("/project/:projectId/content");
  const [searchParams] = useSearchParams();
  const routePath = contentMatch ? searchParams.get("path") : null;
  const closeActiveTab = useCloseActiveTab();
  const currentUrl = location.pathname + location.search;

  return useCallback((filePath: string) => {
    if (!routePath || !sameFile(routePath, filePath)) {
      useSplitPaneStore.getState().openSplit(projectId, filePath);
      return;
    }
    const state: NavState = { openSplit: filePath };
    closeActiveTab(() => {
      navigate(projectHomeUrl(projectId), { replace: true, state: { ...state, closedUrl: currentUrl } });
    }, state);
  }, [closeActiveTab, currentUrl, navigate, projectId, routePath]);
}
