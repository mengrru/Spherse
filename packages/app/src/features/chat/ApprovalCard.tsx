import { CheckIcon, XIcon, ShieldAlertIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import type { TranslationKey } from "@spherse/i18n";
import type { ApprovalCard } from "./types";
import { Button } from "../../components/ui/button";

interface ApprovalCardRendererProps {
  card: ApprovalCard;
  onRespondApproval?: (requestId: string, approved: boolean) => void;
}

const TOOL_LABEL_KEYS: Record<string, TranslationKey> = {
  manage_agent: "tool.manage_agent",
  manage_trigger: "tool.manage_trigger",
};

export function ApprovalCardRenderer({ card, onRespondApproval }: ApprovalCardRendererProps) {
  const { t } = useI18n();
  const labelKey = TOOL_LABEL_KEYS[card.toolName];
  const toolLabel = labelKey ? t(labelKey) : card.toolName;

  if (card.status !== "pending") {
    return (
      <div className="my-2 flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">
        <ShieldAlertIcon className="size-3.5 shrink-0" />
        <span>{toolLabel}</span>
        <span className="ms-auto rounded bg-muted px-1.5 py-0.5 leading-none">
          {card.status === "approved" ? t("approval.approved") : t("approval.rejected")}
        </span>
      </div>
    );
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-warning/50 bg-warning/5">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-xs font-medium text-warning">
        <ShieldAlertIcon className="size-3.5" />
        {t("approval.pending", { tool: toolLabel })}
      </div>
      <div className="px-3 py-2">
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs text-foreground">
          {JSON.stringify(card.args, null, 2)}
        </pre>
        <p className="mt-2 text-[11px] text-muted-foreground">{t("approval.warning")}</p>
        <div className="mt-2 flex justify-end gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={() => card.requestId && onRespondApproval?.(card.requestId, false)}
          >
            <XIcon className="size-3.5" />
            {t("approval.reject")}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => card.requestId && onRespondApproval?.(card.requestId, true)}
          >
            <CheckIcon className="size-3.5" />
            {t("approval.approve")}
          </Button>
        </div>
      </div>
    </div>
  );
}
