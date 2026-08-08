import { AlertTriangleIcon, RotateCwIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useI18n } from "@spherse/i18n/react";

interface SendFailedBarProps {
  onRetry?: () => void;
}

export function SendFailedBar({ onRetry }: SendFailedBarProps) {
  const { t } = useI18n();
  return (
    <div className="mt-1 flex items-center gap-1.5 text-xs text-destructive">
      <AlertTriangleIcon className="size-3" />
      <span>{t("chat.sendFailed")}</span>
      {onRetry && (
        <Button
          variant="ghost"
          size="sm"
          className="h-5 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={onRetry}
          data-chat-retry
        >
          <RotateCwIcon className="size-3" />
          {t("chat.retry")}
        </Button>
      )}
    </div>
  );
}
