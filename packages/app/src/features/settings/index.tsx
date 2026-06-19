import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { FieldGroup } from "../../components/ui/field";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useSettingsStore } from "../../stores/settings-store";
import { useSettingsForm } from "./use-settings-form";
import { type SettingsApi } from "./types";
import { DefaultModelField } from "./DefaultModelField";
import { ModelProviderItem } from "./ModelProviderItem";
import { SectionTitle } from "./SectionTitle";
import { SUPPORTED_LOCALES } from "@spherse/i18n";
import { useI18n } from "@spherse/i18n/react";

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
        <ModelSettingsTab />
      </DialogContent>
    </Dialog>
  );
}

function ModelSettingsTab() {
  const { t } = useI18n();
  const locale = useSettingsStore((s) => s.locale);
  const changeLocale = useSettingsStore((s) => s.changeLocale);
  const form = useSettingsForm(electronAPI);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Tabs defaultValue="models">
        <TabsList>
          <TabsTrigger value="models">{t("settings.tabs.models")}</TabsTrigger>
        </TabsList>
        <TabsContent value="models" className="mt-3">
          <FieldGroup>
            <div>
              <SectionTitle className="mb-2 text-sm font-medium leading-none">
                {t("settings.language")}
              </SectionTitle>
              <NativeSelect className="w-full" value={locale} onChange={(e) => void changeLocale(electronAPI, e.target.value)}>
                {SUPPORTED_LOCALES.map((loc) => (
                  <NativeSelectOption key={loc} value={loc}>{LOCALE_LABELS[loc]}</NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <DefaultModelField
              providers={form.providers}
              apiKeys={form.apiKeys}
              value={form.defaultModel}
              onChange={(model) => { form.setDefaultModel(model); void form.save(undefined, model); }}
            />
          </FieldGroup>
          <div className="mt-5 border-t border-border pt-4">
            <div className="mb-2 text-sm font-medium">{t("settings.models.providers")}</div>
            <div className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto">
              {Object.entries(form.providers).map(([id, config]) => (
                <ModelProviderItem
                  key={id}
                  id={id}
                  config={config}
                  apiKey={form.apiKeys[id] ?? ""}
                  onApiKeyChange={(value) => form.setApiKey(id, value)}
                  onConnect={() => void form.connect(id)}
                  onDisconnect={() => void form.disconnect(id)}
                />
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
