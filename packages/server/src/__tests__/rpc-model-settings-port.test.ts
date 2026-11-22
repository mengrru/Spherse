import { describe, expect, it, vi } from "vitest";
import type { ModelCatalog } from "@spherse/core";
import type { ProjectRegistry } from "../registry.js";
import type { ModelSettingsStore } from "../model-settings.js";
import { createRpcModelSettings } from "../rpc/model-settings-port.js";

vi.mock("../model-settings.js", () => ({
  applyModelSettingsToEnv: vi.fn(),
}));

import { applyModelSettingsToEnv } from "../model-settings.js";

const applied = {
  text: {
    defaultModel: "demo/m1",
    sampling: { temperature: 0.5 },
    thinkingLevel: "low" as const,
  },
};

function createDeps() {
  const store = {
    applyUpdate: vi.fn(() => applied),
    sanitize: vi.fn(() => ({ models: applied })),
  } as unknown as ModelSettingsStore;
  const registry = {
    setDefaultModel: vi.fn(),
    setSampling: vi.fn(),
    setThinkingLevel: vi.fn(),
  } as unknown as ProjectRegistry;
  const catalog = {} as ModelCatalog;
  return { store, registry, catalog };
}

describe("rpc model settings port", () => {
  it("sanitize delegates to the store", () => {
    const { store, registry, catalog } = createDeps();
    const port = createRpcModelSettings(store, catalog, registry);
    port.sanitize();
    expect(store.sanitize).toHaveBeenCalledTimes(1);
  });

  it("apply runs update, env sync and registry side effects, then sanitizes", () => {
    const { store, registry, catalog } = createDeps();
    const port = createRpcModelSettings(store, catalog, registry);
    const result = port.apply({ models: {} });
    expect(store.applyUpdate).toHaveBeenCalledWith({ models: {} });
    expect(applyModelSettingsToEnv).toHaveBeenCalledWith(applied, catalog);
    expect(registry.setDefaultModel).toHaveBeenCalledWith("demo/m1");
    expect(registry.setSampling).toHaveBeenCalledWith({ temperature: 0.5 });
    expect(registry.setThinkingLevel).toHaveBeenCalledWith("low");
    expect(result).toEqual({ models: applied });
  });
});
