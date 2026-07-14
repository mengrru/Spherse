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
import { useSettingsStore } from "../../stores/settings-store";
import { useSettingsForm } from "./use-settings-form";
import { type SettingsApi } from "./types";
import { DefaultModelField } from "./DefaultModelField";
import { ModelProviderItem } from "./ModelProviderItem";
import { SectionTitle } from "./SectionTitle";
import { AdvancedSettings } from "./AdvancedSettings";
import { UpdateChecker } from "./UpdateChecker";
import { SUPPORTED_LOCALES } from "@spherse/i18n";
import { useI18n } from "@spherse/i18n/react";
import type { ThemeMode } from "@shared/electron-api";
import { InfoIcon } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "../../components/ui/tooltip";

const LOCALE_LABELS: Record<string, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  en: "English",
};

const electronAPI: SettingsApi = window.electronAPI;

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
                    void window.electronAPI.openExternal("https://platform.deepseek.com/api_keys");
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
          />
        ))}
      </div>
    </>
  );
}

function SettingsTabs() {
  const { t } = useI18n();
  const locale = useSettingsStore((s) => s.locale);
  const changeLocale = useSettingsStore((s) => s.changeLocale);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const debugToolsEnabled = useSettingsStore((s) => s.debugToolsEnabled);
  const setDebugToolsEnabled = useSettingsStore((s) => s.setDebugToolsEnabled);
  const form = useSettingsForm(electronAPI);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Tabs defaultValue="models">
        <TabsList>
          <TabsTrigger value="models">{t("settings.tabs.text")}</TabsTrigger>
          <TabsTrigger value="image">{t("settings.tabs.image")}</TabsTrigger>
          <TabsTrigger value="general">{t("settings.tabs.general")}</TabsTrigger>
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
            <NativeSelect className="w-full" value={locale} onChange={(e) => void changeLocale(electronAPI, e.target.value)}>
              {SUPPORTED_LOCALES.map((loc) => (
                <NativeSelectOption key={loc} value={loc}>{LOCALE_LABELS[loc]}</NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field className="mt-5">
            <SectionTitle as={FieldLabel}>{t("settings.appearance")}</SectionTitle>
            <NativeSelect className="w-full" value={theme} onChange={(e) => void setTheme(electronAPI, e.target.value as ThemeMode)}>
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
                onCheckedChange={(checked) => { void setDebugToolsEnabled(electronAPI, checked); }}
              />
            </div>
          </FieldGroup>
        </TabsContent>

        <TabsContent value="about" className="mt-3">
          <UpdateChecker />
        </TabsContent>
      </Tabs>
    </div>
  );
}
