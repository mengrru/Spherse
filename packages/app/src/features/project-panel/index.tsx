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
import { AgentSessionList } from "../agent-session-list";
import { SkillPanel } from "../skill-panel";
import { UserFilePanel } from "../user-file-panel";

function isMacPlatform(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac/i.test(platform);
}

export function ProjectPanel() {
  const { t } = useI18n();
  const openGlobalSearch = useAppUiStore((state) => state.setGlobalSearchOpen);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <aside
            data-project-panel
            className="flex h-full w-65 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-sidebar-border bg-sidebar"
          />
        }
      >
        <SidebarProvider className="min-h-0 w-full">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b border-sidebar-border p-2">
              <AgentSessionList />
            </div>
            <UserFilePanel />
            <SkillPanel />
          </div>
        </SidebarProvider>
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
