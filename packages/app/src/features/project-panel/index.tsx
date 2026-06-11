import { useState } from "react";
import { FolderCogIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { FileTree } from "../file-tree";
import { AiReadDenylistDialog } from "../file-tree/AiReadDenylistDialog";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarProvider,
} from "../../components/ui/sidebar";
import { useAppStore, type ProjectState } from "../../stores/app-store";
import { AgentSessionList } from "../agent-session-list";

export interface ProjectPanelProps {
  projectKey: string;
  project: ProjectState;
  activeSessionId: string | null;
  selectedAgentId: string | null;
  selectedFilePath?: string;
  onSelectFile: (filePath: string) => void;
  onFileDeleted: (filePath: string) => void;
}

export function ProjectPanel({
  projectKey,
  project,
  activeSessionId,
  selectedAgentId,
  selectedFilePath,
  onSelectFile,
  onFileDeleted,
}: ProjectPanelProps) {
  const [aiDenylistOpen, setAiDenylistOpen] = useState(false);
  const { t } = useI18n();
  const sidePanelPinned = useAppStore((state) => state.sidePanelPinned);
  const sidePanelHovered = useAppStore((state) => state.sidePanelHovered);
  const showSidePanel = useAppStore((state) => state.showSidePanel);
  const hideSidePanel = useAppStore((state) => state.hideSidePanel);
  const sidePanelVisible = sidePanelPinned || sidePanelHovered;

  return (
    <div
      className={
        sidePanelPinned
          ? "relative z-30 h-full shrink-0 transition-[width] duration-200 ease-out w-65"
          : `absolute top-0 left-14 z-50 h-full w-65 transition-transform duration-200 ease-out ${
              sidePanelVisible ? "translate-x-0" : "-translate-x-[calc(100%+3.5rem)]"
            }`
      }
      {...(!sidePanelPinned && {
        onMouseEnter: showSidePanel,
        onMouseLeave: hideSidePanel,
      })}
    >
      <div className="h-full">
        <aside className="flex h-full w-65 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-border bg-sidebar">
          <SidebarProvider className="min-h-0 w-full">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="border-b border-sidebar-border p-2">
                <AgentSessionList
                  projectKey={projectKey}
                  activeSessionId={activeSessionId}
                  selectedAgentId={selectedAgentId}
                />
              </div>
              <div className="border-b border-sidebar-border p-2">
                <SidebarGroup className="px-0 py-0">
                  <SidebarGroupLabel className="h-7 px-0 text-[11px] font-semibold tracking-wide uppercase">
                    {t("project-panel.files")}
                  </SidebarGroupLabel>
                  <SidebarGroupAction
                    className="top-1 right-0"
                    onClick={() => setAiDenylistOpen(true)}
                    title={t("project-panel.aiReadDenylistTooltip")}
                  >
                    <FolderCogIcon />
                  </SidebarGroupAction>
                  <SidebarGroupContent>
                    <FileTree
                      client={project.ctx.client}
                      selectedFilePath={selectedFilePath}
                      onSelectFile={onSelectFile}
                      onDeleted={onFileDeleted}
                    />
                  </SidebarGroupContent>
                </SidebarGroup>
              </div>
              <AiReadDenylistDialog
                client={project.ctx.client}
                open={aiDenylistOpen}
                onOpenChange={setAiDenylistOpen}
              />
            </div>
          </SidebarProvider>
        </aside>
      </div>
    </div>
  );
}
