import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";
import { useProjectCtx } from "../../context/project-context";
import { useTabsStore } from "../../stores/tabs-store";
import type { NavState } from "../../lib/nav-state";
import {
  isPathAtOrUnder,
  pickNeighborKey,
  projectHomeUrl,
  tabKey,
  tabUrl,
  type TabTarget,
} from "../../lib/tab-target";
import { dropFromProjectNavHistory } from "../../lib/use-project-navigation";
import { useRouteTabTarget } from "./use-route-tab";
import { useTabsEnabled } from "./use-tabs-enabled";
import { useVisibleTabs } from "./use-visible-tabs";

function isContentUrlUnder(url: string, deletedPath: string): boolean {
  const queryIndex = url.indexOf("?");
  if (queryIndex < 0 || !url.slice(0, queryIndex).endsWith("/content")) return false;
  const path = new URLSearchParams(url.slice(queryIndex)).get("path");
  return path !== null && isPathAtOrUnder(path, deletedPath);
}

function neighborUrl(projectId: string, tabs: TabTarget[], neighborKey: string | null): string {
  const neighbor = neighborKey ? tabs.find((t) => tabKey(t) === neighborKey) : undefined;
  return neighbor ? tabUrl(projectId, neighbor) : projectHomeUrl(projectId);
}

export function useTabActions() {
  const { projectId } = useProjectCtx();
  const navigate = useNavigate();
  const location = useLocation();
  const enabled = useTabsEnabled();
  const routeTarget = useRouteTabTarget();
  const visibleTabs = useVisibleTabs();
  const activeKey = routeTarget ? tabKey(routeTarget) : null;
  const currentUrl = location.pathname + location.search;

  const closeTab = useCallback((key: string) => {
    if (key !== activeKey) {
      useTabsStore.getState().closeTab(projectId, key);
      return;
    }
    const target = neighborUrl(projectId, visibleTabs, pickNeighborKey(visibleTabs.map(tabKey), key));
    const state: NavState = { closeTab: key, closedUrl: currentUrl };
    navigate(target, { replace: true, state });
  }, [activeKey, currentUrl, navigate, projectId, visibleTabs]);

  const closeActiveTab = useCallback((fallback: () => void) => {
    if (enabled && activeKey) closeTab(activeKey);
    else fallback();
  }, [activeKey, closeTab, enabled]);

  const closeDeletedFileTabs = useCallback((deletedPath: string) => {
    const tabs = visibleTabs;
    const activeAffected = routeTarget?.kind === "file" && isPathAtOrUnder(routeTarget.path, deletedPath);
    const isAffected = (t: TabTarget) => t.kind === "file" && isPathAtOrUnder(t.path, deletedPath);
    let target = projectHomeUrl(projectId);
    if (activeAffected && enabled && activeKey) {
      const index = tabs.findIndex((t) => tabKey(t) === activeKey);
      const after = tabs.slice(index + 1).find((t) => !isAffected(t));
      const before = [...tabs.slice(0, Math.max(index, 0))].reverse().find((t) => !isAffected(t));
      const neighbor = after ?? before;
      if (neighbor) target = tabUrl(projectId, neighbor);
    }
    useTabsStore.getState().closeFileTabs(projectId, deletedPath);
    dropFromProjectNavHistory(projectId, (url) => isContentUrlUnder(url, deletedPath));
    if (activeAffected) {
      const state: NavState = { skipLeaveGuard: true };
      navigate(target, { replace: enabled, state });
    }
  }, [activeKey, enabled, navigate, projectId, routeTarget, visibleTabs]);

  return { activeKey, closeTab, closeActiveTab, closeDeletedFileTabs };
}

export function useCloseActiveTab(): (fallback: () => void) => void {
  return useTabActions().closeActiveTab;
}

export function useCloseDeletedFileTabs(): (deletedPath: string) => void {
  return useTabActions().closeDeletedFileTabs;
}
