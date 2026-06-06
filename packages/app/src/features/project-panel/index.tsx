import { useState } from "react";
import { FolderCogIcon } from "lucide-react";
import { FileTree } from "../file-tree";
import { AiReadDenylistDialog } from "../file-tree/AiReadDenylistDialog";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarProvider,
} from "../../components/ui/sidebar";
import type { ProjectState } from "../../stores/app-store";
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

  return (
    <aside className="flex w-65 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-border bg-sidebar">
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
                文件
              </SidebarGroupLabel>
              <SidebarGroupAction
                className="top-1 right-0"
                onClick={() => setAiDenylistOpen(true)}
                title="设置 AI 文件读取限制"
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
  );
}
