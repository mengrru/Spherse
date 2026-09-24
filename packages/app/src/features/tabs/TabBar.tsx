import { useState, type DragEvent } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { useProjectCtx } from "../../context/project-context";
import { useIsMobile } from "../../hooks/use-mobile";
import { projectHomeUrl, tabKey, tabUrl } from "../../lib/tab-target";
import { useTabsStore } from "../../stores/tabs-store";
import { TargetTab, WelcomeTab } from "./TabItems";
import type { TabDragProps } from "./TabShell";
import { useIsWelcomeRoute } from "./use-route-tab";
import { useTabActions } from "./use-tab-actions";
import { useTabsEnabled } from "./use-tabs-enabled";
import { useVisibleTabs } from "./use-visible-tabs";

function useTabDrag(projectId: string, enabled: boolean) {
  const moveTab = useTabsStore((s) => s.moveTab);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const reset = () => {
    setDragKey(null);
    setOverKey(null);
  };

  return (key: string): TabDragProps => ({
    draggable: enabled,
    dropTarget: dragKey !== null && overKey === key && dragKey !== key,
    onDragStart: (e: DragEvent<HTMLDivElement>) => {
      setDragKey(key);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", key);
    },
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (!dragKey) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (overKey !== key) setOverKey(key);
    },
    onDragLeave: () => setOverKey((k) => (k === key ? null : k)),
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (dragKey) moveTab(projectId, dragKey, key);
      reset();
    },
    onDragEnd: reset,
  });
}

export function TabBar() {
  const { t } = useI18n();
  const { projectId } = useProjectCtx();
  const navigate = useNavigate();
  const enabled = useTabsEnabled();
  const isMobile = useIsMobile();
  const visible = useVisibleTabs();
  const isWelcome = useIsWelcomeRoute();
  const { activeKey, closeTab } = useTabActions();
  const dragProps = useTabDrag(projectId, !isMobile);

  if (!enabled) return null;

  return (
    <div
      data-tab-bar
      role="tablist"
      aria-label={t("tabs.label")}
      className="flex h-9 shrink-0 items-stretch overflow-x-auto overflow-y-hidden border-b border-border bg-muted/40"
    >
      <WelcomeTab
        active={isWelcome}
        onSelect={() => {
          if (!isWelcome) navigate(projectHomeUrl(projectId));
        }}
      />
      {visible.map((target) => {
        const key = tabKey(target);
        return (
          <TargetTab
            key={key}
            tabKey={key}
            target={target}
            active={key === activeKey}
            onSelect={() => {
              if (key !== activeKey) navigate(tabUrl(projectId, target));
            }}
            onClose={() => closeTab(key)}
            drag={dragProps(key)}
          />
        );
      })}
    </div>
  );
}
