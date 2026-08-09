import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { Button } from "../../components/ui/button";
import { ChevronRightIcon, AlertTriangleIcon, RotateCwIcon, SettingsIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { ErrorEventCode } from "@spherse/server/contracts";
import { useAppUiStore } from "../../stores/app-ui-store";

interface ErrorMessageSectionProps {
  error: string;
  errorCode?: ErrorEventCode;
  onRetry?: () => void;
}

export function ErrorMessageSection({ error, errorCode, onRetry }: ErrorMessageSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useI18n();
  const openSettings = useAppUiStore((s) => s.openSettings);

  const detail = errorCode === ErrorEventCode.ModelNotConfigured
    ? t("chat.error.modelNotConfigured")
    : errorCode === ErrorEventCode.Auth
      ? t("chat.error.authFailed")
      : error;
  const isAuth = errorCode === ErrorEventCode.Auth;

  return (
    <div className="mt-2 border-t border-dashed border-border pt-2" data-chat-error>
      <Collapsible open={expanded}>
        <CollapsibleTrigger
          render={<Button variant="ghost" className="-mx-1 h-auto w-full justify-start gap-1 px-1 py-1 pe-3 text-xs text-destructive hover:text-destructive" />}
          onClick={() => setExpanded((v) => !v)}
        >
          <span
            className="inline-flex size-3 items-center justify-center transition-transform"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            <ChevronRightIcon className="size-3" />
          </span>
          <AlertTriangleIcon className="size-3" />
          {t("chat.responseGenerationFailed")}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-4 mt-0.5 mb-1.5 text-xs text-destructive break-all">
            {detail}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {isAuth && (
        <Button
          variant="ghost"
          size="sm"
          className="ms-1 mb-1 h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => openSettings("models")}
          data-chat-open-settings
        >
          <SettingsIcon className="size-3" />
          {t("chat.error.openSettings")}
        </Button>
      )}
      {onRetry && (
        <Button
          variant="ghost"
          size="sm"
          className="ms-1 mb-1 h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
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
