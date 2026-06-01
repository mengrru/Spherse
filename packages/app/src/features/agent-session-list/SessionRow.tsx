import type { SessionInfo } from "../../lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../../components/ui/sidebar";
import { MoreHorizontalIcon } from "lucide-react";

interface SessionRowProps {
  session: SessionInfo;
  active: boolean;
  onSelect: (session: SessionInfo) => void;
  onDelete: (sessionId: string) => void;
}

export function SessionRow({ session, active, onSelect, onDelete }: SessionRowProps) {
  return (
    <SidebarMenuSubItem className="group/session-row">
      <SidebarMenuSubButton
        isActive={active}
        className="cursor-pointer pr-6"
        onClick={() => onSelect(session)}
      >
        <span>
          {session.title ?? new Date(session.updatedAt).toLocaleString()}
        </span>
      </SidebarMenuSubButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuAction className="top-1 right-0 md:opacity-0 group-hover/session-row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 data-popup-open:opacity-100 data-open:opacity-100" />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(session.id)}>
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuSubItem>
  );
}
