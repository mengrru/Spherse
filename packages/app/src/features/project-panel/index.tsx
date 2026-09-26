import { useI18n } from "@spherse/i18n/react";
import { SidebarProvider } from "../../components/ui/sidebar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "../../components/ui/context-menu";
import { useAppUiStore } from "../../stores/app-ui-store";
import { useCustomSidePanelStore } from "../../stores/custom-side-panel-store";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";
import { useCustomSidePanel } from "../../queries/custom-side-panel";
import { AgentSessionList } from "../agent-session-list";
import { SkillPanel } from "../skill-panel";
import { UserFilePanel } from "../user-file-panel";
import { CustomSidePanel } from "../custom-side-panel";

function isMacPlatform(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac/i.test(platform);
}

export function ProjectPanel() {
  const { t } = useI18n();
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const active = useCustomSidePanelStore((state) => state.isActive(projectId));
  const { data, isError } = useCustomSidePanel(projectId, client);
  const openGlobalSearch = useAppUiStore((state) => state.setGlobalSearchOpen);

  const resolvedPath = isError ? null : data?.path;
  const showCustomSidePanel = active && resolvedPath != null;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <aside
            data-project-panel
            className={
              showCustomSidePanel
                ? "flex h-full w-65 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar"
                : "flex h-full w-65 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-sidebar-border bg-sidebar"
            }
          />
        }
      >
        {showCustomSidePanel ? (
          <CustomSidePanel key={projectId} path={resolvedPath} />
        ) : (
          <SidebarProvider className="min-h-0 w-full">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="border-b border-sidebar-border p-2">
                <AgentSessionList />
              </div>
              <UserFilePanel />
              <SkillPanel />
            </div>
          </SidebarProvider>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onClick={() => {
            openGlobalSearch(true);
          }}
        >
          {t("global-search.search")}
          <ContextMenuShortcut>{isMacPlatform() ? "⌘P" : "Ctrl P"}</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
