import { getAvatarColor } from "../lib/avatar-color";

interface ProjectAvatarProps {
  name: string;
  path: string;
  active: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export function ProjectAvatar({ name, path, active, onClick, onContextMenu }: ProjectAvatarProps) {
  const letter = name.charAt(0).toUpperCase();

  return (
    <div
      title={name}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="cursor-pointer transition-all duration-150 hover:opacity-90 flex items-center justify-center rounded-lg shrink-0 select-none"
      style={{
        width: 36,
        height: 36,
        backgroundColor: getAvatarColor(path),
        borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
        opacity: active ? 1 : 0.55,
        boxShadow: active ? "inset 0 0 0 2px var(--accent)" : undefined,
        color: "var(--primary)",
        fontWeight: 600,
        fontSize: 15,
      }}
    >
      {letter}
    </div>
  );
}
