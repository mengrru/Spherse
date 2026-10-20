import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomProviderDef, SamplingParams } from "@spherse/core";
import type { ModelSettingsRequest, ModelSettingsResponse } from "@spherse/contracts";
import type { ModelSettingsApi } from "./types";
import { useSettingsForm } from "./use-settings-form";

function emptyResponse(): ModelSettingsResponse {
  return {
    models: {
      text: { defaultModel: "", providers: {} },
      image: { defaultModel: "", providers: {} },
    },
    customProviders: [],
  };
}

function createApi(overrides: { settings?: ModelSettingsResponse | null } = {}): ModelSettingsApi {
  let current: ModelSettingsResponse = overrides.settings ?? emptyResponse();
  return {
    getModelSettings: vi.fn(async () => current),
    updateModelSettings: vi.fn(async (req: ModelSettingsRequest) => {
      const applyGroup = (
        prev: Record<string, { configured: boolean }>,
        reqProviders: Record<string, { apiKey?: string }> | undefined,
      ): Record<string, { configured: boolean }> => {
        const map: Record<string, { configured: boolean }> = {};
        for (const id of Object.keys(prev)) {
          if (prev[id].configured) map[id] = { configured: true };
        }
        for (const [id, write] of Object.entries(reqProviders ?? {})) {
          if (write?.apiKey?.trim()) map[id] = { configured: true };
          else if (write?.apiKey === "") delete map[id];
        }
        return map;
      };
      current = {
        models: {
          text: {
            defaultModel: req.models.text.defaultModel,
            providers: applyGroup(current.models.text.providers, req.models.text.providers),
            sampling: req.models.text.sampling,
            thinkingLevel: req.models.text.thinkingLevel,
          },
          image: {
            defaultModel: req.models.image.defaultModel,
            providers: applyGroup(current.models.image.providers, req.models.image.providers),
          },
        },
        customProviders: req.customProviders ?? current.customProviders,
      };
      return current;
    }),
    getSupportedProviders: vi.fn(async () => ({ "builtin-x": {} as never })),
    getImageProviders: vi.fn(async () => ({ "img-x": {} as never })),
  };
}

function lastRequest(api: ModelSettingsApi): ModelSettingsRequest {
  const calls = (api.updateModelSettings as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1][0];
}

let api: ModelSettingsApi;

beforeEach(() => {
  api = createApi({
    settings: {
      models: {
        text: {
          defaultModel: "builtin-x/m1",
          providers: { "builtin-x": { configured: true } },
          sampling: { temperature: 0.5 },
          thinkingLevel: "low",
        },
        image: { defaultModel: "img-x/i1", providers: {} },
      },
      customProviders: [{ id: "custom-old", name: "Old", baseUrl: "https://old.example", models: ["m"], keyless: false }],
    },
  });
});

describe("useSettingsForm init", () => {
  it("reads sampling, thinkingLevel and configured map from the sanitized response", async () => {
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => {
      expect(result.current.text.sampling).toEqual({ temperature: 0.5 });
      expect(result.current.text.thinkingLevel).toBe("low");
      expect(result.current.text.configured["builtin-x"]).toBe(true);
    });
  });

  it("does not populate key inputs from the server (write-only keys)", async () => {
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => expect(result.current.text.configured["builtin-x"]).toBe(true));
    expect(result.current.text.apiKeys["builtin-x"]).toBeUndefined();
  });

  it("does not read sampling or thinkingLevel from the image group", async () => {
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => expect(result.current.image.configured).toBeDefined());
    expect(result.current.image.sampling).toBeUndefined();
    expect(result.current.image.thinkingLevel).toBeUndefined();
  });

  it("reads customProviders from the response on init", async () => {
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => expect(result.current.text.customProviders).toHaveLength(1));
  });
});

describe("useSettingsForm save payload", () => {
  it("persists a sampling patch immediately and merges it into the text group only", async () => {
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => expect(result.current.text.sampling).toEqual({ temperature: 0.5 }));

    let ok = false;
    await act(async () => {
      ok = await result.current.text.patchSampling({ topP: 0.9 });
    });
    expect(ok).toBe(true);
    expect(result.current.text.sampling).toEqual({ temperature: 0.5, topP: 0.9 });
    expect(lastRequest(api).models.text.sampling).toEqual({ temperature: 0.5, topP: 0.9 });
  });

  it("clears sampling when the merge leaves all params undefined", async () => {
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => expect(result.current.text.sampling).toEqual({ temperature: 0.5 }));

    await act(async () => {
      await result.current.text.patchSampling({ temperature: undefined });
    });
    expect(result.current.text.sampling).toEqual({});
    expect(lastRequest(api).models.text.sampling).toEqual({});
  });

  it("persists thinkingLevel changes on the text group only", async () => {
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => expect(result.current.text.thinkingLevel).toBe("low"));

    await act(async () => {
      await result.current.text.changeThinkingLevel("high");
    });
    expect(result.current.text.thinkingLevel).toBe("high");
    expect(lastRequest(api).models.text.thinkingLevel).toBe("high");
  });

  it("commitApiKey persists a non-empty key", async () => {
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => expect(result.current.text.configured["builtin-x"]).toBe(true));

    await act(async () => {
      result.current.text.commitApiKey("builtin-y", "new-key");
    });
    await waitFor(() => expect(api.updateModelSettings).toHaveBeenCalled());
    expect(lastRequest(api).models.text.providers?.["builtin-y"]).toEqual({ apiKey: "new-key" });
  });

  it("commitApiKey with an empty value is a no-op and never clears a stored key", async () => {
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => expect(result.current.text.configured["builtin-x"]).toBe(true));

    await act(async () => {
      result.current.text.commitApiKey("builtin-x", "");
    });
    expect(api.updateModelSettings).not.toHaveBeenCalled();
    expect(result.current.text.configured["builtin-x"]).toBe(true);
  });

  it("commitApiKey is a no-op while the provider is already configured", async () => {
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => expect(result.current.text.configured["builtin-x"]).toBe(true));

    await act(async () => {
      result.current.text.commitApiKey("builtin-x", "late-key");
    });
    expect(api.updateModelSettings).not.toHaveBeenCalled();
    expect(result.current.text.configured["builtin-x"]).toBe(true);
  });

  it("a save response keeps keys typed into other providers that were not committed", async () => {
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => expect(result.current.text.configured["builtin-x"]).toBe(true));

    act(() => {
      result.current.text.setApiKey("builtin-y", "draft-key");
    });
    await act(async () => {
      await result.current.text.changeDefaultModel("builtin-x/m2");
    });
    expect(lastRequest(api).models.text.defaultModel).toBe("builtin-x/m2");
    expect(result.current.text.apiKeys["builtin-y"]).toBe("draft-key");
  });
});

describe("useSettingsForm connect", () => {
  it("commits the typed key itself without relying on a prior blur commit", async () => {
    api = createApi();
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => expect(result.current.text.configured).toBeDefined());

    act(() => {
      result.current.text.setApiKey("builtin-x", "connect-key");
    });
    let ok = false;
    await act(async () => {
      ok = await result.current.text.connect("builtin-x");
    });
    expect(ok).toBe(true);
    expect(lastRequest(api).models.text.providers?.["builtin-x"]).toEqual({ apiKey: "connect-key" });
    await waitFor(() => expect(result.current.text.configured["builtin-x"]).toBe(true));
    expect(result.current.text.apiKeys["builtin-x"]).toBeUndefined();
  });

  it("commits the typed key on the image group too", async () => {
    api = createApi();
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => expect(result.current.image.configured).toBeDefined());

    act(() => {
      result.current.image.setApiKey("img-x", "img-key");
    });
    let ok = false;
    await act(async () => {
      ok = await result.current.image.connect("img-x");
    });
    expect(ok).toBe(true);
    expect(lastRequest(api).models.image.providers?.["img-x"]).toEqual({ apiKey: "img-key" });
    await waitFor(() => expect(result.current.image.configured["img-x"]).toBe(true));
  });

  it("returns false without saving when no key has been typed", async () => {
    api = createApi();
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => expect(result.current.text.configured).toBeDefined());

    let ok = true;
    await act(async () => {
      ok = await result.current.text.connect("builtin-x");
    });
    expect(ok).toBe(false);
    expect(api.updateModelSettings).not.toHaveBeenCalled();
  });
});

describe("useSettingsForm disconnect", () => {
  it("sends an explicit clear, clears its model default and preserves sampling", async () => {
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => expect(result.current.text.sampling).toEqual({ temperature: 0.5 }));

    let ok = false;
    await act(async () => {
      ok = await result.current.text.disconnect("builtin-x");
    });
    expect(ok).toBe(true);
    expect(result.current.text.apiKeys["builtin-x"]).toBeUndefined();
    expect(result.current.text.configured["builtin-x"]).toBeUndefined();
    expect(result.current.text.sampling).toEqual({ temperature: 0.5 });
    expect(lastRequest(api).models.text.providers?.["builtin-x"]).toEqual({ apiKey: "" });
    expect(lastRequest(api).models.text.defaultModel).toBe("");
    expect(lastRequest(api).models.text.sampling).toEqual({ temperature: 0.5 });
  });
});

describe("useSettingsForm custom providers", () => {
  it("addCustomProvider generates an id, saves and refreshes the catalog", async () => {
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => expect(result.current.text.customProviders).toHaveLength(1));

    let ok = false;
    await act(async () => {
      ok = await result.current.text.addCustomProvider!({ id: "", name: "New", baseUrl: "https://new.example", models: ["m"], keyless: false });
    });
    expect(ok).toBe(true);
    const saved = lastRequest(api).customProviders!;
    const added = saved.find((c: { name: string }) => c.name === "New")!;
    expect(added.id).toBeTruthy();
    expect(added.id).not.toBe("custom-old");
    expect(api.getSupportedProviders).toHaveBeenCalledTimes(2);
  });

  it("updateCustomProvider keeps the id stable", async () => {
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => expect(result.current.text.customProviders).toHaveLength(1));

    await act(async () => {
      await result.current.text.updateCustomProvider!("custom-old", { id: "ignored", name: "Renamed", baseUrl: "https://new.example", models: ["m"], keyless: false });
    });
    expect(lastRequest(api).customProviders).toEqual([{ id: "custom-old", name: "Renamed", baseUrl: "https://new.example", models: ["m"], keyless: false }] as CustomProviderDef[]);
  });

  it("removeCustomProvider clears the key and defaultModel referencing the provider", async () => {
    api = createApi({
      settings: {
        models: {
          text: {
            defaultModel: "custom-old/m1",
            providers: { "custom-old": { configured: true } },
            sampling: { temperature: 0.5 },
          },
          image: { defaultModel: "", providers: {} },
        },
        customProviders: [{ id: "custom-old", name: "Old", baseUrl: "https://old.example", models: ["m"], keyless: false }],
      },
    });
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => expect(result.current.text.customProviders).toHaveLength(1));

    await act(async () => {
      await result.current.text.removeCustomProvider!("custom-old");
    });
    expect(lastRequest(api).customProviders).toEqual([]);
    expect(lastRequest(api).models.text.providers?.["custom-old"]).toBeUndefined();
    expect(lastRequest(api).models.text.defaultModel).toBe("");
    expect(lastRequest(api).models.text.sampling).toEqual({ temperature: 0.5 } as SamplingParams);
  });

  it("does not expose custom provider methods on the image group", async () => {
    const { result } = renderHook(() => useSettingsForm(api));
    await waitFor(() => expect(result.current.image.configured).toBeDefined());
    expect(result.current.image.addCustomProvider).toBeUndefined();
    expect(result.current.image.updateCustomProvider).toBeUndefined();
    expect(result.current.image.removeCustomProvider).toBeUndefined();
  });
});
