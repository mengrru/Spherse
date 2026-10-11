import { useEffect, useState, useCallback } from "react";
import type { CustomProviderDef, SamplingParams, ThinkingLevel } from "@spherse/core";
import type { ModelSettingsRequest, ModelSettingsResponse } from "@spherse/contracts";
import type { ProviderConfig, ModelSettingsApi } from "./types";
import { generateCustomProviderId } from "./custom-provider-id.js";

interface GroupFormState {
  providers: Record<string, ProviderConfig>;
  configured: Record<string, boolean>;
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
  configured: Record<string, boolean>;
  apiKeys: Record<string, string>;
  writes: Record<string, string>;
  clears: Record<string, true>;
  defaultModel: string;
  sampling?: SamplingParams;
  thinkingLevel?: ThinkingLevel;
}

const EMPTY_GROUP: GroupData = { configured: {}, apiKeys: {}, writes: {}, clears: {}, defaultModel: "" };

function providersPayload(group: GroupData): Record<string, { apiKey?: string }> {
  const providers: Record<string, { apiKey?: string }> = {};
  for (const [id, apiKey] of Object.entries(group.writes)) {
    if (apiKey.trim()) providers[id] = { apiKey };
  }
  for (const id of Object.keys(group.clears)) {
    if (!providers[id]) providers[id] = { apiKey: "" };
  }
  return providers;
}

function configuredFromResponse(response: ModelSettingsResponse): { text: Record<string, boolean>; image: Record<string, boolean> } {
  const toMap = (providers: Record<string, { configured: boolean }>): Record<string, boolean> => {
    const map: Record<string, boolean> = {};
    for (const [id, entry] of Object.entries(providers)) {
      if (entry.configured) map[id] = true;
    }
    return map;
  };
  return {
    text: toMap(response.models.text.providers),
    image: toMap(response.models.image.providers),
  };
}

export function useSettingsForm(api: ModelSettingsApi | null) {
  const [textProviders, setTextProviders] = useState<Record<string, ProviderConfig>>({});
  const [imageProviders, setImageProviders] = useState<Record<string, ProviderConfig>>({});
  const [textData, setTextData] = useState<GroupData>(EMPTY_GROUP);
  const [imageData, setImageData] = useState<GroupData>(EMPTY_GROUP);
  const [saving, setSaving] = useState(false);
  const [customProviders, setCustomProviders] = useState<CustomProviderDef[]>([]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        const [textCatalog, imageCatalog, settings] = await Promise.all([
          api.getSupportedProviders(),
          api.getImageProviders(),
          api.getModelSettings(),
        ]);
        if (cancelled) return;
        setTextProviders(textCatalog ?? {});
        setImageProviders(imageCatalog ?? {});
        const configured = configuredFromResponse(settings);
        setTextData({ ...EMPTY_GROUP, configured: configured.text, defaultModel: settings.models.text.defaultModel ?? "", sampling: settings.models.text.sampling, thinkingLevel: settings.models.text.thinkingLevel });
        setImageData({ ...EMPTY_GROUP, configured: configured.image, defaultModel: settings.models.image.defaultModel ?? "" });
        setCustomProviders(settings.customProviders ?? []);
      } catch {
        if (!cancelled) {
          setTextProviders({});
          setImageProviders({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const applyResponse = useCallback((response: ModelSettingsResponse) => {
    const configured = configuredFromResponse(response);
    setTextData((prev) => ({ ...prev, configured: configured.text, apiKeys: {}, writes: {}, clears: {} }));
    setImageData((prev) => ({ ...prev, configured: configured.image, apiKeys: {}, writes: {}, clears: {} }));
    setCustomProviders(response.customProviders ?? []);
  }, []);

  const save = useCallback(
    async (
      textOverride?: GroupData,
      imageOverride?: GroupData,
      customProvidersOverride?: CustomProviderDef[],
    ): Promise<boolean> => {
      if (!api) return false;
      const t = textOverride ?? textData;
      const i = imageOverride ?? imageData;
      const cp = customProvidersOverride ?? customProviders;
      const request: ModelSettingsRequest = {
        models: {
          text: {
            defaultModel: t.defaultModel,
            providers: providersPayload(t),
            sampling: t.sampling,
            thinkingLevel: t.thinkingLevel,
          },
          image: {
            defaultModel: i.defaultModel,
            providers: providersPayload(i),
          },
        },
        customProviders: cp,
      };
      setSaving(true);
      try {
        const response = await api.updateModelSettings(request);
        applyResponse(response);
        return true;
      } catch {
        return false;
      } finally {
        setSaving(false);
      }
    },
    [api, textData, imageData, customProviders, applyResponse],
  );

  const refreshTextCatalog = useCallback(async () => {
    if (!api) return;
    const textCatalog = await api.getSupportedProviders().catch(() => null);
    if (textCatalog) setTextProviders(textCatalog);
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
      const nextKeys = { ...textData.apiKeys };
      delete nextKeys[id];
      const nextWrites = { ...textData.writes };
      delete nextWrites[id];
      const nextClears = { ...textData.clears };
      delete nextClears[id];
      const nextModel = textData.defaultModel.startsWith(`${id}/`) ? "" : textData.defaultModel;
      const nextTextData: GroupData = { ...textData, apiKeys: nextKeys, writes: nextWrites, clears: nextClears, defaultModel: nextModel };
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
    configured: data.configured,
    apiKeys: data.apiKeys,
    defaultModel: data.defaultModel,
    sampling: data.sampling,
    thinkingLevel: data.thinkingLevel,
    setApiKey: (id, value) => {
      setData({ ...data, apiKeys: { ...data.apiKeys, [id]: value } });
    },
    commitApiKey: (id, value) => {
      if (!value.trim()) return;
      const next: GroupData = {
        ...data,
        apiKeys: { ...data.apiKeys, [id]: value },
        writes: { ...data.writes, [id]: value },
      };
      delete next.clears[id];
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
      const nextApiKeys = { ...data.apiKeys };
      delete nextApiKeys[id];
      const nextWrites = { ...data.writes };
      delete nextWrites[id];
      const providerModel = data.defaultModel.startsWith(`${id}/`);
      const nextModel = providerModel ? "" : data.defaultModel;
      const next: GroupData = {
        ...data,
        apiKeys: nextApiKeys,
        writes: nextWrites,
        clears: { ...data.clears, [id]: true },
        defaultModel: nextModel,
      };
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
