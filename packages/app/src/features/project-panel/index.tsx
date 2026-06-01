import { FileTree } from "../../components/FileTree";
import {
  SidebarGroup,
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
  onSelectFile: (filePath: string) => void;
  onFileDeleted: (filePath: string) => void;
}

export function ProjectPanel({
  projectKey,
  project,
  activeSessionId,
  selectedAgentId,
  onSelectFile,
  onFileDeleted,
}: ProjectPanelProps) {
  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar">
      <SidebarProvider className="min-h-0 w-full">
        <div className="flex flex-1 flex-col">
          <div className="border-b border-sidebar-border p-2">
            <AgentSessionList
              projectKey={projectKey}
              activeSessionId={activeSessionId}
              selectedAgentId={selectedAgentId}
            />
          </div>
          <SidebarGroup className="border-b border-sidebar-border p-2">
            <SidebarGroupLabel className="h-7 px-0 text-[11px] font-semibold tracking-wide uppercase">
              文件
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <FileTree
                client={project.ctx.client}
                onSelectFile={onSelectFile}
                onDeleted={onFileDeleted}
              />
            </SidebarGroupContent>
          </SidebarGroup>
        </div>
      </SidebarProvider>
    </aside>
  );
}
