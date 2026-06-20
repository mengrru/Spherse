import { useState } from "react";
import { FolderCogIcon } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
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
import { useSidePanel } from "../../hooks/use-side-panel";
import { AgentSessionList } from "../agent-session-list";
import { useProjectCtx } from "../../context/project-context";

export function ProjectPanel() {
  const { projectId } = useProjectCtx();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [aiDenylistOpen, setAiDenylistOpen] = useState(false);
  const { t } = useI18n();
  const { pinned, visible, show, hide } = useSidePanel();
  const contentPath = searchParams.get("path") ?? undefined;

  const handleSelectFile = (filePath: string) => {
    if (!projectId) return;
    navigate(`/project/${projectId}/content?path=${encodeURIComponent(filePath)}`);
  };

  const handleFileDeleted = (deletedPath: string) => {
    if (contentPath && (contentPath === deletedPath || contentPath.startsWith(`${deletedPath}/`))) {
      if (projectId) navigate(`/project/${projectId}`);
    }
  };

  return (
    <div
      className={
        pinned
          ? "relative z-30 h-full shrink-0 transition-[width] duration-200 ease-out w-65"
          : `absolute top-0 left-14 z-50 h-full w-65 transition-transform duration-200 ease-out ${
              visible ? "translate-x-0" : "-translate-x-[calc(100%+3.5rem)]"
            }`
      }
      {...(!pinned && {
        onMouseEnter: show,
        onMouseLeave: hide,
      })}
    >
      <div className="h-full">
        <aside className="flex h-full w-65 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-border bg-sidebar">
          <SidebarProvider className="min-h-0 w-full">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="border-b border-sidebar-border p-2">
                <AgentSessionList />
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
                      selectedFilePath={contentPath}
                      onSelectFile={handleSelectFile}
                      onDeleted={handleFileDeleted}
                    />
                  </SidebarGroupContent>
                </SidebarGroup>
              </div>
              <AiReadDenylistDialog
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
