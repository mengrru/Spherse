import type { AgentProfile } from "../../lib/types";

interface HeaderProps {
  agent: AgentProfile;
}

export function Header({ agent }: HeaderProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-3">
      <span className="font-semibold text-[15px]">{agent.name}</span>
    </div>
  );
}
