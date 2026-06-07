import type { AgentProfile } from "../../lib/types";
import { Button } from "../../components/ui/button";
import { XIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";

interface HeaderProps {
  agent: AgentProfile;
  onClose?: () => void;
}

export function Header({ agent, onClose }: HeaderProps) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-3">
      <span className="font-semibold text-[15px]">{agent.name}</span>
      {onClose && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          onClick={onClose}
          title={t("chat.close")}
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
}
