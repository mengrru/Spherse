import { useMemo } from "react";
import { useProjectCtx } from "../../context/project-context";
import { useFeature } from "../../lib/use-feature";
import type { TabTarget } from "../../lib/tab-target";
import { useTabsStore } from "./store";

const EMPTY_TABS: TabTarget[] = [];

export function useVisibleTabs(): TabTarget[] {
  const { projectId } = useProjectCtx();
  const browserEnabled = useFeature("browser");
  const tabs = useTabsStore((s) => s.byProject[projectId] ?? EMPTY_TABS);
  return useMemo(
    () => (browserEnabled ? tabs : tabs.filter((tab) => tab.kind !== "browser")),
    [browserEnabled, tabs],
  );
}
