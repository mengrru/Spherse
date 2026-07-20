import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "../../components/ui/field";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Switch } from "../../components/ui/switch";
import { Button } from "../../components/ui/button";
import { useSettingsStore } from "../../stores/settings-store";
import { useSettingsForm } from "./use-settings-form";
import { type SettingsApi } from "./types";
import { DefaultModelField } from "./DefaultModelField";
import { ModelProviderItem } from "./ModelProviderItem";
import { CustomProviderDialog } from "./CustomProviderDialog";
import { SectionTitle } from "./SectionTitle";
import { AdvancedSettings } from "./AdvancedSettings";
import { UpdateChecker } from "./UpdateChecker";
import { MobileAccessPanel } from "./MobileAccessPanel";
import { SUPPORTED_LOCALES } from "@spherse/i18n";
import { useI18n } from "@spherse/i18n/react";
import type { CustomProviderDef } from "@spherse/core";
import type { ThemeMode } from "../../lib/host-bridge";
import { InfoIcon, Plus } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "../../components/ui/tooltip";
import { useHostBridge } from "../../context/host-bridge-context";

const LOCALE_LABELS: Record<string, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  en: "English",
};

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { t } = useI18n();
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
        </DialogHeader>
        <SettingsTabs />
      </DialogContent>
    </Dialog>
  );
}

function ModelGroupTab({
  group,
  kind,
}: {
  group: ReturnType<typeof useSettingsForm>["text"];
  kind: "text" | "image";
}) {
  const { t } = useI18n();
  const bridge = useHostBridge();
  const [dialog, setDialog] = useState<{ mode: "add" } | { mode: "edit"; def: CustomProviderDef } | null>(null);
  return (
    <>
      <FieldGroup>
        <DefaultModelField
          providers={group.providers}
          apiKeys={group.apiKeys}
          value={group.defaultModel}
          onChange={(model) => { void group.changeDefaultModel(model); }}
        />
      </FieldGroup>
      {kind === "text" && (
        <AdvancedSettings
          className="mt-3"
          sampling={group.sampling}
          onSetSampling={(value) => { void group.patchSampling(value); }}
        />
      )}
      <SectionTitle className={kind === "text" ? "mt-5 flex items-center gap-1.5" : "mt-5"}>
        {t("settings.models.providers")}
        {kind === "text" && (
          <Tooltip>
            <TooltipTrigger
              aria-label={t("settings.models.providersHintAria")}
              className="inline-flex cursor-help text-muted-foreground"
            >
              <InfoIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>
              <span>
                {t("settings.models.providersHintPre")}
                <a
                  className="text-background underline underline-offset-2"
                  href="https://platform.deepseek.com/api_keys"
                  onClick={(e) => {
                    e.preventDefault();
                    void bridge.openExternal("https://platform.deepseek.com/api_keys");
                  }}
                >
                  DeepSeek
                </a>
                {t("settings.models.providersHintPost")}
              </span>
            </TooltipContent>
          </Tooltip>
        )}
      </SectionTitle>
      <div className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto">
        {Object.entries(group.providers).map(([id, config]) => (
          <ModelProviderItem
            key={id}
            id={id}
            config={config}
            apiKey={group.apiKeys[id] ?? ""}
            onApiKeyChange={(value) => group.setApiKey(id, value)}
            onConnect={() => void group.connect(id)}
            onDisconnect={() => void group.disconnect(id)}
            onEdit={
              config.custom
                ? () => {
                    const def = group.customProviders?.find((c) => c.id === id);
                    if (def) setDialog({ mode: "edit", def });
                  }
                : undefined
            }
            onDelete={
              config.custom
                ? () => { void group.removeCustomProvider?.(id); }
                : undefined
            }
          />
        ))}
      </div>
      {kind === "text" && (
        <Button variant="outline" className="mt-2 w-full" onClick={() => setDialog({ mode: "add" })}>
          <Plus className="size-3.5" />
          {t("settings.provider.addCustom")}
        </Button>
      )}
      {kind === "text" && (
        <CustomProviderDialog
          open={dialog !== null}
          onClose={() => setDialog(null)}
          initial={dialog?.mode === "edit" ? dialog.def : undefined}
          onSubmit={(def) => {
            if (dialog?.mode === "edit") {
              void group.updateCustomProvider?.(dialog.def.id, def);
            } else {
              void group.addCustomProvider?.(def);
            }
            setDialog(null);
          }}
        />
      )}
    </>
  );
}

function SettingsTabs() {
  const { t } = useI18n();
  const bridge = useHostBridge();
  const locale = useSettingsStore((s) => s.locale);
  const changeLocale = useSettingsStore((s) => s.changeLocale);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const debugToolsEnabled = useSettingsStore((s) => s.debugToolsEnabled);
  const setDebugToolsEnabled = useSettingsStore((s) => s.setDebugToolsEnabled);
  const mobileAccessEnabled = bridge.capabilities.mobileAccess;
  const settingsApi = useMemo<SettingsApi>(() => ({
    getSettings: bridge.getSettings,
    saveSettings: bridge.saveSettings,
    getSupportedProviders: bridge.getSupportedProviders ?? (async () => ({})),
    getImageProviders: bridge.getImageProviders ?? (async () => ({})),
  }), [bridge]);
  const form = useSettingsForm(settingsApi);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Tabs defaultValue="models">
        <TabsList>
          <TabsTrigger value="models">{t("settings.tabs.text")}</TabsTrigger>
          <TabsTrigger value="image">{t("settings.tabs.image")}</TabsTrigger>
          <TabsTrigger value="general">{t("settings.tabs.general")}</TabsTrigger>
          {mobileAccessEnabled && <TabsTrigger value="mobile">{t("settings.tabs.mobile")}</TabsTrigger>}
          <TabsTrigger value="about">{t("settings.tabs.about")}</TabsTrigger>
        </TabsList>

        <TabsContent value="models" className="mt-3">
          <ModelGroupTab group={form.text} kind="text" />
        </TabsContent>

        <TabsContent value="image" className="mt-3">
          <ModelGroupTab group={form.image} kind="image" />
        </TabsContent>

        <TabsContent value="general" className="mt-3">
          <Field>
            <SectionTitle as={FieldLabel}>{t("settings.language")}</SectionTitle>
            <NativeSelect className="w-full" value={locale} onChange={(e) => void changeLocale(settingsApi, e.target.value)}>
              {SUPPORTED_LOCALES.map((loc) => (
                <NativeSelectOption key={loc} value={loc}>{LOCALE_LABELS[loc]}</NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field className="mt-5">
            <SectionTitle as={FieldLabel}>{t("settings.appearance")}</SectionTitle>
            <NativeSelect className="w-full" value={theme} onChange={(e) => void setTheme(settingsApi, e.target.value as ThemeMode)}>
              <NativeSelectOption value="light">{t("settings.appearance.light")}</NativeSelectOption>
              <NativeSelectOption value="dark">{t("settings.appearance.dark")}</NativeSelectOption>
              <NativeSelectOption value="system">{t("settings.appearance.system")}</NativeSelectOption>
            </NativeSelect>
          </Field>
          <FieldGroup className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium leading-none">{t("settings.debugTools")}</span>
                <span className="text-xs text-muted-foreground">{t("settings.debugToolsDesc")}</span>
              </div>
              <Switch
                checked={debugToolsEnabled}
                onCheckedChange={(checked) => { void setDebugToolsEnabled(settingsApi, checked); }}
              />
            </div>
          </FieldGroup>
        </TabsContent>

        {mobileAccessEnabled && (
          <TabsContent value="mobile" className="mt-3">
            <MobileAccessPanel />
          </TabsContent>
        )}

        <TabsContent value="about" className="mt-3">
          <UpdateChecker />
        </TabsContent>
      </Tabs>
    </div>
  );
}
