import { useEffect, useState, useCallback } from "react";
import type { ProviderConfig, SettingsApi } from "./types";

export function useSettingsForm(api: SettingsApi) {
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [defaultModel, setDefaultModel] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const [providerCatalog, settings] = await Promise.all([
        api.getSupportedProviders(),
        api.getSettings(),
      ]);
      setProviders(providerCatalog ?? {});
      const keys: Record<string, string> = {};
      for (const [id, config] of Object.entries(settings?.providers ?? {})) {
        if (config?.apiKey) {
          keys[id] = config.apiKey;
        }
      }
      setApiKeys(keys);
      setDefaultModel(settings?.defaultModel ?? "");
    })();
  }, [api]);

  const setApiKey = useCallback((id: string, value: string) => {
    setApiKeys((prev) => ({ ...prev, [id]: value }));
  }, []);

  const save = useCallback(async (keys?: Record<string, string>, model?: string): Promise<boolean> => {
    const effectiveKeys = keys ?? apiKeys;
    const effectiveModel = model ?? defaultModel;
    const providersPayload: Record<string, { apiKey: string } | undefined> = {};
    for (const id of Object.keys(providers)) {
      providersPayload[id] = { apiKey: (effectiveKeys[id] ?? "").trim() };
    }
    setSaving(true);
    try {
      await api.saveSettings({
        providers: providersPayload,
        defaultModel: effectiveModel,
      });
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, [api, apiKeys, defaultModel, providers]);

  const connect = useCallback(async (id: string): Promise<boolean> => {
    if (!apiKeys[id]?.trim()) return false;
    return save();
  }, [apiKeys, save]);

  const disconnect = useCallback(async (id: string): Promise<boolean> => {
    const nextKeys = { ...apiKeys, [id]: "" };
    const providerModel = defaultModel.startsWith(`${id}/`);
    const nextModel = providerModel ? "" : defaultModel;
    setApiKeys(nextKeys);
    setDefaultModel(nextModel);
    return save(nextKeys, nextModel);
  }, [apiKeys, defaultModel, save]);

  return {
    providers,
    apiKeys,
    defaultModel,
    saving,
    setApiKey,
    setDefaultModel,
    save,
    connect,
    disconnect,
  };
}
