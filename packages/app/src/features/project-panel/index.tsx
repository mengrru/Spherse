import {
  SidebarProvider,
} from "../../components/ui/sidebar";
import { useSidePanel } from "../../hooks/use-side-panel";
import { AgentSessionList } from "../agent-session-list";
import { SkillPanel } from "../skill-panel";
import { UserFilePanel } from "../user-file-panel";

export function ProjectPanel() {
  const { pinned, visible, show, hide } = useSidePanel();

  return (
    <div
      className={
        pinned
          ? "relative z-30 h-full shrink-0 transition-[width] duration-200 ease-out w-65"
          : `absolute top-0 left-[52px] z-50 h-full w-65 transition-transform duration-200 ease-out ${
              visible ? "translate-x-0" : "-translate-x-[calc(100%+3.5rem)]"
            }`
      }
      {...(!pinned && {
        onMouseEnter: show,
        onMouseLeave: hide,
      })}
    >
      <div className="h-full">
        <aside data-project-panel className="flex h-full w-65 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-border bg-sidebar">
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
      </div>
    </div>
  );
}
