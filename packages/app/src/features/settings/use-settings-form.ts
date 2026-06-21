import { useEffect, useState, useCallback } from "react";
import type { ProviderConfig, SettingsApi } from "./types";

interface GroupFormState {
  providers: Record<string, ProviderConfig>;
  apiKeys: Record<string, string>;
  defaultModel: string;
  setApiKey: (id: string, value: string) => void;
  changeDefaultModel: (model: string) => Promise<boolean>;
  connect: (id: string) => Promise<boolean>;
  disconnect: (id: string) => Promise<boolean>;
}

interface GroupData {
  apiKeys: Record<string, string>;
  defaultModel: string;
}

function extractKeys(providers: Record<string, { apiKey?: string }> | undefined): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const [id, c] of Object.entries(providers ?? {})) {
    if (c?.apiKey) keys[id] = c.apiKey;
  }
  return keys;
}

function keysToProviders(keys: Record<string, string>): Record<string, { apiKey: string }> {
  const providers: Record<string, { apiKey: string }> = {};
  for (const [id, key] of Object.entries(keys)) {
    providers[id] = { apiKey: key };
  }
  return providers;
}

export function useSettingsForm(api: SettingsApi) {
  const [textProviders, setTextProviders] = useState<Record<string, ProviderConfig>>({});
  const [imageProviders, setImageProviders] = useState<Record<string, ProviderConfig>>({});
  const [textData, setTextData] = useState<GroupData>({ apiKeys: {}, defaultModel: "" });
  const [imageData, setImageData] = useState<GroupData>({ apiKeys: {}, defaultModel: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const [textCatalog, imageCatalog, settings] = await Promise.all([
        api.getSupportedProviders(),
        api.getImageProviders(),
        api.getSettings(),
      ]);
      setTextProviders(textCatalog ?? {});
      setImageProviders(imageCatalog ?? {});
      setTextData({
        apiKeys: extractKeys(settings?.models?.text?.providers),
        defaultModel: settings?.models?.text?.defaultModel ?? "",
      });
      setImageData({
        apiKeys: extractKeys(settings?.models?.image?.providers),
        defaultModel: settings?.models?.image?.defaultModel ?? "",
      });
    })();
  }, [api]);

  const save = useCallback(
    async (
      textOverride?: GroupData,
      imageOverride?: GroupData,
    ): Promise<boolean> => {
      const t = textOverride ?? textData;
      const i = imageOverride ?? imageData;
      setSaving(true);
      try {
        await api.saveSettings({
          models: {
            text: { defaultModel: t.defaultModel, providers: keysToProviders(t.apiKeys) },
            image: { defaultModel: i.defaultModel, providers: keysToProviders(i.apiKeys) },
          },
        });
        return true;
      } catch {
        return false;
      } finally {
        setSaving(false);
      }
    },
    [api, textData, imageData],
  );

  const makeGroup = (
    kind: "text" | "image",
    providers: Record<string, ProviderConfig>,
    data: GroupData,
    setData: (d: GroupData) => void,
  ): GroupFormState => ({
    providers,
    apiKeys: data.apiKeys,
    defaultModel: data.defaultModel,
    setApiKey: (id, value) => {
      setData({ ...data, apiKeys: { ...data.apiKeys, [id]: value } });
    },
    changeDefaultModel: async (model) => {
      const next = { ...data, defaultModel: model };
      setData(next);
      return kind === "text" ? save(next, undefined) : save(undefined, next);
    },
    connect: async (id) => {
      if (!data.apiKeys[id]?.trim()) return false;
      return save();
    },
    disconnect: async (id) => {
      const nextKeys = { ...data.apiKeys, [id]: "" };
      const providerModel = data.defaultModel.startsWith(`${id}/`);
      const nextModel = providerModel ? "" : data.defaultModel;
      const next = { apiKeys: nextKeys, defaultModel: nextModel };
      setData(next);
      return kind === "text" ? save(next, undefined) : save(undefined, next);
    },
  });

  return {
    saving,
    text: makeGroup("text", textProviders, textData, setTextData),
    image: makeGroup("image", imageProviders, imageData, setImageData),
  };
}
