import { PencilIcon, Trash2Icon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { useI18n } from "@spherse/i18n/react";
import type { ProviderConfig } from "./types";

export function ModelProviderItem({
  id,
  config,
  apiKey,
  onApiKeyChange,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
}: {
  id: string;
  config: ProviderConfig;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useI18n();
  const configured = apiKey.trim().length > 0;
  const isCustom = config.custom === true;
  const isKeyless = config.keyless === true;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{config.name}</span>
            {isCustom ? (
              <Badge variant="outline">{t("settings.provider.customBadge")}</Badge>
            ) : null}
          </div>
          {isCustom && config.baseUrl ? (
            <span className="text-xs text-muted-foreground">{config.baseUrl}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {isCustom && onEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("common.edit")}
              onClick={onEdit}
            >
              <PencilIcon />
            </Button>
          ) : null}
          {isCustom && onDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("common.delete")}
              onClick={onDelete}
            >
              <Trash2Icon />
            </Button>
          ) : null}
          {isKeyless ? (
            <Badge variant="secondary" title={t("settings.provider.keylessHint")}>
              {t("settings.provider.keylessBadge")}
            </Badge>
          ) : (
            <Badge variant={configured ? "secondary" : "outline"}>
              {configured ? t("settings.provider.apiKeyProvided") : t("settings.provider.notConnected")}
            </Badge>
          )}
        </div>
      </div>
      {isKeyless ? null : (
        <div className="flex gap-2">
          <Input
            type="password"
            className="flex-1"
            placeholder={t("settings.provider.apiKeyPlaceholder")}
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            autoComplete={`off-${id}`}
          />
          {configured ? (
            <Button type="button" variant="outline" className="group min-w-20" onClick={onDisconnect}>
              <span className="group-hover:hidden">{t("settings.provider.connected")}</span>
              <span className="hidden group-hover:inline">{t("settings.provider.disconnect")}</span>
            </Button>
          ) : (
            <Button type="button" className="min-w-20" onClick={onConnect} disabled={!apiKey.trim()}>
              {t("settings.provider.connect")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
