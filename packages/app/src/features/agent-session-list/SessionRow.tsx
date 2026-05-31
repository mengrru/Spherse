import type { SessionInfo } from "../../lib/types";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { MoreHorizontalIcon } from "lucide-react";

interface SessionRowProps {
  session: SessionInfo;
  active: boolean;
  onSelect: (session: SessionInfo) => void;
  onDelete: (sessionId: string) => void;
}

export function SessionRow({ session, active, onSelect, onDelete }: SessionRowProps) {
  return (
    <li>
      <div
        className={`group flex cursor-pointer items-center gap-1 rounded-r py-1 pl-2 text-[12px] transition-colors hover:bg-muted ${active ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground"}`}
        onClick={() => onSelect(session)}
      >
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {session.title ?? new Date(session.updatedAt).toLocaleString()}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />}>
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(session.id)}>
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
