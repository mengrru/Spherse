import { getAvatarColor } from "./avatar-color";
import { Avatar, AvatarFallback } from "../../components/ui/avatar";

interface ProjectAvatarProps {
  name: string;
  path: string;
  active: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function ProjectAvatar({ name, path, active, onClick, onContextMenu }: ProjectAvatarProps) {
  const letter = name.charAt(0).toUpperCase();

  return (
    <Avatar
      title={name}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="size-9 cursor-pointer shrink-0 select-none rounded-lg transition-all duration-150 hover:opacity-90"
      style={{
        opacity: active ? 1 : 0.5,
      }}
    >
      <AvatarFallback
        className="rounded-lg font-semibold text-foreground"
        style={{ backgroundColor: getAvatarColor(path) }}
      >
        {letter}
      </AvatarFallback>
    </Avatar>
  );
}
