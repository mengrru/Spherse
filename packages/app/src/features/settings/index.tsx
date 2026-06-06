import { useEffect } from "react";
import type { ComponentProps, ElementType } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "../../components/ui/native-select";
import { Badge } from "../../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "./store";
import { type ProviderConfig, type SettingsApi } from "./types";
import { SUPPORTED_LOCALES } from "@spherse/i18n";
import { useI18n } from "@spherse/i18n/react";

const LOCALE_LABELS: Record<string, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  en: "English",
};

interface SettingsModalProps {
  onClose: () => void;
}

const electronAPI = (window as unknown as { electronAPI: SettingsApi }).electronAPI;

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { t } = useI18n();
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
        </DialogHeader>
        <ModelSettingsTab onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function ModelSettingsTab({ onClose }: { onClose: () => void }) {
  const apiKeys = useSettingsStore((state) => state.apiKeys);
  const defaultModel = useSettingsStore((state) => state.defaultModel);
  const locale = useSettingsStore((state) => state.locale);
  const saving = useSettingsStore((state) => state.saving);
  const message = useSettingsStore((state) => state.message);
  const load = useSettingsStore((state) => state.load);
  const setApiKey = useSettingsStore((state) => state.setApiKey);
  const setDefaultModel = useSettingsStore((state) => state.setDefaultModel);
  const setLocale = useSettingsStore((state) => state.setLocale);
  const save = useSettingsStore((state) => state.save);
  const connect = useSettingsStore((state) => state.connect);
  const disconnect = useSettingsStore((state) => state.disconnect);
  const providers = useSettingsStore((state) => state.providers);
  const { t } = useI18n();

  useEffect(() => {
    void load(electronAPI);
  }, [load]);

  const handleConnect = async (id: string) => {
    await connect(electronAPI, id);
  };

  const handleDisconnect = async (id: string) => {
    await disconnect(electronAPI, id);
  };

  const handleModelChange = async (model: string) => {
    setDefaultModel(model);
    await save(electronAPI, undefined, model);
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Tabs defaultValue="models">
          <TabsList>
            <TabsTrigger value="models">{t("settings.tabs.models")}</TabsTrigger>
          </TabsList>
          <TabsContent value="models" className="mt-3">
            <FieldGroup>
              <Field>
                <SectionTitle as={FieldLabel}>语言 / Language</SectionTitle>
                <NativeSelect className="w-full" value={locale} onChange={(e) => setLocale(e.target.value)}>
                  {SUPPORTED_LOCALES.map((loc) => (
                    <NativeSelectOption key={loc} value={loc}>{LOCALE_LABELS[loc]}</NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <DefaultModelField
                providers={providers}
                apiKeys={apiKeys}
                value={defaultModel}
                onChange={handleModelChange}
              />
            </FieldGroup>
            <div className="mt-5 border-t border-border pt-4">
              <div className="mb-2 text-sm font-medium">{t("settings.models.providers")}</div>
              <div className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto">
                {Object.entries(providers).map(([id, config]) => (
                  <ModelProviderItem
                    key={id}
                    id={id}
                    config={config}
                    apiKey={apiKeys[id] ?? ""}
                    onApiKeyChange={(value) => setApiKey(id, value)}
                    onConnect={() => handleConnect(id)}
                    onDisconnect={() => handleDisconnect(id)}
                  />
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
      <DialogFooter className="shrink-0 -mx-4 -mb-4 items-center border-t border-border bg-muted/30 px-4 py-3">
        {message === "saved" && (
          <span className="mr-auto text-xs text-muted-foreground">{t("settings.models.saved")}</span>
        )}
        {message === "error" && (
          <span className="mr-auto text-xs text-destructive">{t("settings.models.saveFailed")}</span>
        )}
        <Button variant="outline" onClick={onClose}>
          {t("settings.models.close")}
        </Button>
        <Button onClick={() => save(electronAPI)} disabled={saving}>
          {saving ? t("settings.models.saving") : t("settings.models.save")}
        </Button>
      </DialogFooter>
    </>
  );
}

function ModelProviderItem({
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
        <div>
          <div className="text-sm font-medium">{config.name}</div>
          <div className="text-xs text-muted-foreground">{config.auth.envKeys[0] ?? ""}</div>
        </div>
        <Badge variant={configured ? "secondary" : "outline"}>
          {configured ? t("settings.provider.apiKeyProvided") : t("settings.provider.notConnected")}
        </Badge>
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          className="flex-1"
          placeholder={config.auth.envKeys[0] ?? ""}
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

function DefaultModelField({
  providers,
  apiKeys,
  value,
  onChange,
}: {
  providers: Record<string, ProviderConfig>;
  apiKeys: Record<string, string>;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const configuredProviders = Object.entries(providers).filter(([id]) => apiKeys[id]?.trim());

  return (
    <Field>
      <SectionTitle as={FieldLabel}>{t("settings.models.defaultModel")}</SectionTitle>
      <NativeSelect className="w-full" value={value} onChange={(e) => onChange(e.target.value)}>
        <NativeSelectOption value="">{t("settings.models.selectPlaceholder")}</NativeSelectOption>
        {configuredProviders.map(([id, config]) => (
          <NativeSelectOptGroup key={id} label={config.name}>
            {config.models.map((m) => (
              <NativeSelectOption key={`${id}/${m.id}`} value={`${id}/${m.id}`}>
                {m.name}
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
        ))}
      </NativeSelect>
      {configuredProviders.length === 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">{t("settings.models.configureFirst")}</p>
      )}
    </Field>
  );
}

function SectionTitle({
  as: Component = "div",
  className,
  ...props
}: ComponentProps<"div"> & {
  as?: ElementType;
}) {
  return (
    <Component
      className={cn("mb-2 text-sm font-medium leading-none", className)}
      {...props}
    />
  );
}
