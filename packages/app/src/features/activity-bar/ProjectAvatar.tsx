import { Avatar, AvatarFallback } from "../../components/ui/avatar";
import { cn } from "../../lib/utils";

interface ProjectAvatarProps {
  name: string;
  active: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function ProjectAvatar({ name, active, onClick, onContextMenu }: ProjectAvatarProps) {
  const letter = name.charAt(0).toUpperCase();

  return (
    <Avatar
      data-project-avatar
      data-active={active ? "" : undefined}
      title={name}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "size-9 cursor-pointer shrink-0 select-none rounded-lg after:rounded-lg transition-all duration-150 hover:opacity-90",
        active ? "opacity-100" : "opacity-30",
      )}
    >
      <AvatarFallback className="rounded-lg bg-background font-semibold text-foreground">
        {letter}
      </AvatarFallback>
    </Avatar>
  );
}
