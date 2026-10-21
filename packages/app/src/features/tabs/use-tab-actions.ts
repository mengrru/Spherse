import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";
import { useProjectCtx } from "../../context/project-context";
import { useTabsStore } from "./store";
import type { NavState } from "../../lib/nav-state";
import {
  isPathAtOrUnder,
  pickNeighborKey,
  projectHomeUrl,
  tabKey,
  tabUrl,
  type TabTarget,
} from "../../lib/tab-target";
import { stripMessageId } from "../../lib/route-params";
import { dropFromProjectNavHistory, sameNavUrl } from "../../lib/use-project-navigation";
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
  const currentUrl = stripMessageId(location.pathname, location.search);

  const closeTab = useCallback((key: string, extraState?: NavState) => {
    if (key !== activeKey) {
      useTabsStore.getState().closeTab(projectId, key);
      return;
    }
    const target = neighborUrl(projectId, visibleTabs, pickNeighborKey(visibleTabs.map(tabKey), key));
    const state: NavState = { ...extraState, closeTab: key, closedUrl: currentUrl };
    navigate(target, { replace: true, state });
  }, [activeKey, currentUrl, navigate, projectId, visibleTabs]);

  const closeOtherTabs = useCallback((keepKey: string | null) => {
    const keepTarget = keepKey === null ? null : visibleTabs.find((t) => tabKey(t) === keepKey) ?? null;
    if (keepKey !== null && !keepTarget) return;
    const others = keepKey === null ? visibleTabs : visibleTabs.filter((t) => tabKey(t) !== keepKey);
    if (others.length === 0) return;
    const keepUrl = keepTarget ? tabUrl(projectId, keepTarget) : projectHomeUrl(projectId);
    const storeOthers = (useTabsStore.getState().byProject[projectId] ?? []).filter(
      (t) => keepKey === null || tabKey(t) !== keepKey,
    );

    if (activeKey !== null && others.some((t) => tabKey(t) === activeKey)) {
      const closedUrls: string[] = [];
      for (const target of storeOthers) {
        if (tabKey(target) === activeKey) continue;
        useTabsStore.getState().closeTab(projectId, tabKey(target));
        closedUrls.push(tabUrl(projectId, target));
      }
      if (closedUrls.length > 0) {
        dropFromProjectNavHistory(projectId, (url) => closedUrls.some((c) => sameNavUrl(url, c)));
      }
      navigate(keepUrl, { replace: true, state: { closeTab: activeKey, closedUrl: currentUrl } });
      return;
    }

    useTabsStore.getState().closeOthers(projectId, keepKey);
    if (storeOthers.length > 0) {
      dropFromProjectNavHistory(projectId, (url) => storeOthers.some((t) => sameNavUrl(url, tabUrl(projectId, t))));
    }
    if (keepTarget && activeKey === null) navigate(keepUrl);
  }, [activeKey, currentUrl, navigate, projectId, visibleTabs]);

  const closeActiveTab = useCallback((fallback: () => void, extraState?: NavState) => {
    if (enabled && activeKey) closeTab(activeKey, extraState);
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

  return { activeKey, closeTab, closeOtherTabs, closeActiveTab, closeDeletedFileTabs };
}

export function useCloseActiveTab(): (fallback: () => void, extraState?: NavState) => void {
  return useTabActions().closeActiveTab;
}

export function useCloseDeletedFileTabs(): (deletedPath: string) => void {
  return useTabActions().closeDeletedFileTabs;
}
