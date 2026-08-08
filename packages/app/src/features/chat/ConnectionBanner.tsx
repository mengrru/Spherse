import { WifiOffIcon, RotateCwIcon, AlertTriangleIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useI18n } from "@spherse/i18n/react";

interface ConnectionBannerProps {
  connectionStatus: "disconnected" | "connecting" | "open";
  reconnectFailed: boolean;
  historyError: boolean;
  onReconnect: () => void;
  onRetryHistory: () => void;
}

export function ConnectionBanner({
  connectionStatus,
  reconnectFailed,
  historyError,
  onReconnect,
  onRetryHistory,
}: ConnectionBannerProps) {
  const { t } = useI18n();

  if (historyError) {
    return (
      <div className="mx-auto mb-2 flex items-center justify-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
        <AlertTriangleIcon className="size-3.5" />
        <span>{t("chat.historyLoadFailed")}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          onClick={onRetryHistory}
        >
          <RotateCwIcon className="size-3" />
          {t("chat.historyLoadRetry")}
        </Button>
      </div>
    );
  }

  if (reconnectFailed) {
    return (
      <div className="mx-auto mb-2 flex items-center justify-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
        <WifiOffIcon className="size-3.5" />
        <span>{t("chat.connectionReconnectFailed")}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          onClick={onReconnect}
        >
          <RotateCwIcon className="size-3" />
          {t("chat.connectionReconnect")}
        </Button>
      </div>
    );
  }

  if (connectionStatus === "disconnected") {
    return (
      <div className="mx-auto mb-2 flex items-center justify-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
        <WifiOffIcon className="size-3.5" />
        <span>{t("chat.connectionReconnecting")}</span>
      </div>
    );
  }

  return null;
}
