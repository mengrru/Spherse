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
}: {
  id: string;
  config: ProviderConfig;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const { t } = useI18n();
  const configured = apiKey.trim().length > 0;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{config.name}</div>
        <Badge variant={configured ? "secondary" : "outline"}>
          {configured ? t("settings.provider.apiKeyProvided") : t("settings.provider.notConnected")}
        </Badge>
      </div>
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
    </div>
  );
}
