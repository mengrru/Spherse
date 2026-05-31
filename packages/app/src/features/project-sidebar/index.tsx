import { FileTree } from "../../components/FileTree";
import type { ProjectState } from "../../stores/app-store";
import { AgentSessionList } from "../agent-session-list";

export interface ProjectSidebarProps {
  projectKey: string;
  project: ProjectState;
  activeSessionId: string | null;
  selectedAgentId: string | null;
  onSelectFile: (filePath: string) => void;
  onFileDeleted: (filePath: string) => void;
}

export function ProjectSidebar({
  projectKey,
  project,
  activeSessionId,
  selectedAgentId,
  onSelectFile,
  onFileDeleted,
}: ProjectSidebarProps) {
  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-background">
      <div className="border-b border-border p-3">
        <AgentSessionList
          projectKey={projectKey}
          activeSessionId={activeSessionId}
          selectedAgentId={selectedAgentId}
        />
      </div>
      <div className="border-b border-border p-3">
        <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">文件</h3>
        <FileTree
          client={project.ctx.client}
          onSelectFile={onSelectFile}
          onDeleted={onFileDeleted}
        />
      </div>
    </aside>
  );
}
