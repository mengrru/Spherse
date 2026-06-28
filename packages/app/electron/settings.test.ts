import { describe, expect, it, vi } from "vitest";

vi.mock("electron-store", () => ({
  default: class MockStore {
    private data: Record<string, unknown> = {};
    get(key: string) {
      return this.data[key];
    }
    set(key: string, value: unknown) {
      this.data[key] = value;
    }
  },
}));

import { maskModelGroup, mergeModelGroup } from "./settings";

describe("mergeModelGroup temperature passthrough", () => {
  it("uses incoming temperature when present", () => {
    const result = mergeModelGroup(
      { defaultModel: "deepseek/v4", providers: {}, temperature: 0.7 },
      { defaultModel: "", providers: {}, temperature: 0.3 },
    );

    expect(result.temperature).toBe(0.7);
  });

  it("does not fall back to prev when incoming has no temperature", () => {
    const result = mergeModelGroup(
      { defaultModel: "deepseek/v4", providers: {} },
      { defaultModel: "", providers: {}, temperature: 0.3 },
    );

    expect(result.temperature).toBeUndefined();
  });

  it("is undefined when neither has temperature", () => {
    const result = mergeModelGroup(
      { defaultModel: "deepseek/v4", providers: {} },
      { defaultModel: "", providers: {} },
    );

    expect(result.temperature).toBeUndefined();
  });

  it("clears temperature when incoming is explicitly undefined", () => {
    const result = mergeModelGroup(
      { defaultModel: "deepseek/v4", providers: {}, temperature: undefined },
      { defaultModel: "", providers: {}, temperature: 0.5 },
    );

    expect(result.temperature).toBeUndefined();
  });
});

describe("maskModelGroup temperature passthrough", () => {
  it("preserves temperature without masking", () => {
    const result = maskModelGroup({
      defaultModel: "deepseek/v4",
      providers: { deepseek: { apiKey: "sk-secret-key-12345" } },
      temperature: 0.4,
    });

    expect(result.temperature).toBe(0.4);
    expect(result.providers.deepseek?.apiKey).toBe("sk-s****2345");
  });

  it("passes through undefined temperature", () => {
    const result = maskModelGroup({ defaultModel: "", providers: {} });

    expect(result.temperature).toBeUndefined();
  });
});
