import {
  SidebarProvider,
} from "../../components/ui/sidebar";
import { AgentSessionList } from "../agent-session-list";
import { SkillPanel } from "../skill-panel";
import { UserFilePanel } from "../user-file-panel";

export function ProjectPanel() {
  return (
    <aside
      data-project-panel
      className="flex h-full w-65 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-sidebar-border bg-sidebar"
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
    </aside>
  );
}
