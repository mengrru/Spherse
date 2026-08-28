import { useEffect, useState, useCallback } from "react";
import type { CustomProviderDef, SamplingParams, ThinkingLevel } from "@spherse/core";
import type { ProviderConfig, SettingsApi } from "./types";
import { generateCustomProviderId } from "./custom-provider-id.js";

interface GroupFormState {
  providers: Record<string, ProviderConfig>;
  apiKeys: Record<string, string>;
  defaultModel: string;
  sampling?: SamplingParams;
  thinkingLevel?: ThinkingLevel;
  setApiKey: (id: string, value: string) => void;
  commitApiKey: (id: string, value: string) => void;
  changeDefaultModel: (model: string) => Promise<boolean>;
  patchSampling: (params: SamplingParams) => Promise<boolean>;
  changeThinkingLevel: (level: ThinkingLevel | undefined) => Promise<boolean>;
  connect: (id: string) => Promise<boolean>;
  disconnect: (id: string) => Promise<boolean>;
  customProviders?: CustomProviderDef[];
  addCustomProvider?: (def: CustomProviderDef) => Promise<boolean>;
  updateCustomProvider?: (id: string, def: CustomProviderDef) => Promise<boolean>;
  removeCustomProvider?: (id: string) => Promise<boolean>;
}

export type { GroupFormState };

interface GroupData {
  apiKeys: Record<string, string>;
  defaultModel: string;
  sampling?: SamplingParams;
  thinkingLevel?: ThinkingLevel;
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
  const [customProviders, setCustomProviders] = useState<CustomProviderDef[]>([]);

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
        sampling: settings?.models?.text?.sampling,
        thinkingLevel: settings?.models?.text?.thinkingLevel,
      });
      setImageData({
        apiKeys: extractKeys(settings?.models?.image?.providers),
        defaultModel: settings?.models?.image?.defaultModel ?? "",
      });
      setCustomProviders(settings?.customProviders ?? []);
    })();
  }, [api]);

  const save = useCallback(
    async (
      textOverride?: GroupData,
      imageOverride?: GroupData,
      customProvidersOverride?: CustomProviderDef[],
    ): Promise<boolean> => {
      const t = textOverride ?? textData;
      const i = imageOverride ?? imageData;
      const cp = customProvidersOverride ?? customProviders;
      setSaving(true);
      try {
        await api.saveSettings({
          models: {
            text: { defaultModel: t.defaultModel, providers: keysToProviders(t.apiKeys), sampling: t.sampling, thinkingLevel: t.thinkingLevel },
            image: { defaultModel: i.defaultModel, providers: keysToProviders(i.apiKeys) },
          },
          customProviders: cp,
        });
        return true;
      } catch {
        return false;
      } finally {
        setSaving(false);
      }
    },
    [api, textData, imageData, customProviders],
  );

  const refreshTextCatalog = useCallback(async () => {
    const textCatalog = await api.getSupportedProviders();
    setTextProviders(textCatalog ?? {});
  }, [api]);

  const addCustomProvider = useCallback(
    async (def: CustomProviderDef): Promise<boolean> => {
      const existingIds = [...Object.keys(textProviders), ...customProviders.map((c) => c.id)];
      const id = generateCustomProviderId(def.name, existingIds);
      const withId = { ...def, id };
      const next = [...customProviders, withId];
      setCustomProviders(next);
      const ok = await save(undefined, undefined, next);
      if (ok) await refreshTextCatalog();
      return ok;
    },
    [textProviders, customProviders, save, refreshTextCatalog],
  );

  const updateCustomProvider = useCallback(
    async (id: string, def: CustomProviderDef): Promise<boolean> => {
      const next = customProviders.map((c) => (c.id === id ? { ...def, id } : c));
      setCustomProviders(next);
      const ok = await save(undefined, undefined, next);
      if (ok) await refreshTextCatalog();
      return ok;
    },
    [customProviders, save, refreshTextCatalog],
  );

  const removeCustomProvider = useCallback(
    async (id: string): Promise<boolean> => {
      const next = customProviders.filter((c) => c.id !== id);
      const nextApiKeys = { ...textData.apiKeys };
      delete nextApiKeys[id];
      const nextModel = textData.defaultModel.startsWith(`${id}/`) ? "" : textData.defaultModel;
      const nextTextData = { ...textData, apiKeys: nextApiKeys, defaultModel: nextModel };
      setCustomProviders(next);
      setTextData(nextTextData);
      const ok = await save(nextTextData, undefined, next);
      if (ok) await refreshTextCatalog();
      return ok;
    },
    [customProviders, textData, save, refreshTextCatalog],
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
    sampling: data.sampling,
    thinkingLevel: data.thinkingLevel,
    setApiKey: (id, value) => {
      setData({ ...data, apiKeys: { ...data.apiKeys, [id]: value } });
    },
    commitApiKey: (id, value) => {
      const next = { ...data, apiKeys: { ...data.apiKeys, [id]: value } };
      setData(next);
      if (kind === "text") void save(next, undefined);
      else void save(undefined, next);
    },
    changeDefaultModel: async (model) => {
      const next = { ...data, defaultModel: model };
      setData(next);
      return kind === "text" ? save(next, undefined) : save(undefined, next);
    },
    patchSampling: async (params) => {
      const next = { ...data, sampling: mergeSampling(data.sampling, params) };
      setData(next);
      return kind === "text" ? save(next, undefined) : save(undefined, next);
    },
    changeThinkingLevel: async (level) => {
      const next = { ...data, thinkingLevel: level };
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
      const next = { ...data, apiKeys: nextKeys, defaultModel: nextModel };
      setData(next);
      return kind === "text" ? save(next, undefined) : save(undefined, next);
    },
  });

  const textGroup = makeGroup("text", textProviders, textData, setTextData);
  return {
    saving,
    text: {
      ...textGroup,
      customProviders,
      addCustomProvider,
      updateCustomProvider,
      removeCustomProvider,
    },
    image: makeGroup("image", imageProviders, imageData, setImageData),
  };
}

function mergeSampling(prev: SamplingParams | undefined, patch: SamplingParams): SamplingParams {
  const merged: SamplingParams = { ...prev, ...patch };
  return merged.temperature === undefined && merged.topP === undefined ? {} : merged;
}
