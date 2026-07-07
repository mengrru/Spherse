import { describe, it, expect, vi } from "vitest";

const { resolveModelByIdMock } = vi.hoisted(() => ({
  resolveModelByIdMock: vi.fn((modelId: string) => ({ id: modelId, provider: "x", contextWindow: 32768 })),
}));

vi.mock("../../model-providers/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../model-providers/index.js")>();
  return {
    ...actual,
    resolveModelById: resolveModelByIdMock,
  };
});

import {
  resolveEffectiveModelId,
  resolveContextWindow,
  extractLastUsageTotalTokens,
  computeSessionStatus,
} from "../../session/status.js";
import type { AgentProfile } from "../../types.js";

const baseProfile: AgentProfile = {
  id: "a1",
  name: "A",
  slug: "a",
  model: undefined,
  systemPrompt: "",
  tools: [],
  context: [],
  createdAt: 0,
  updatedAt: 0,
};

describe("resolveEffectiveModelId", () => {
  it("prefers the profile model", () => {
    expect(resolveEffectiveModelId({ ...baseProfile, model: "openai/gpt" }, "fallback")).toBe("openai/gpt");
  });

  it("falls back to the global default model", () => {
    expect(resolveEffectiveModelId(baseProfile, "anthropic/claude")).toBe("anthropic/claude");
  });

  it("returns undefined when neither is set", () => {
    expect(resolveEffectiveModelId(baseProfile, undefined)).toBeUndefined();
  });

  it("treats empty strings as unset", () => {
    expect(resolveEffectiveModelId({ ...baseProfile, model: "" }, "")).toBeUndefined();
  });
});

describe("resolveContextWindow", () => {
  it("returns the contextWindow from the resolved model", () => {
    resolveModelByIdMock.mockReturnValueOnce({ id: "m", provider: "p", contextWindow: 200000 });
    expect(resolveContextWindow({ ...baseProfile, model: "p/m" })).toBe(200000);
  });

  it("returns null when no model can be resolved", () => {
    expect(resolveContextWindow(baseProfile, undefined)).toBeNull();
  });

  it("returns null when resolveModelById throws", () => {
    resolveModelByIdMock.mockImplementationOnce(() => {
      throw new Error("unknown model");
    });
    expect(resolveContextWindow({ ...baseProfile, model: "p/missing" })).toBeNull();
  });

  it("returns null when the resolved model lacks contextWindow", () => {
    resolveModelByIdMock.mockReturnValueOnce({ id: "m", provider: "p" });
    expect(resolveContextWindow({ ...baseProfile, model: "p/m" })).toBeNull();
  });
});

describe("extractLastUsageTotalTokens", () => {
  it("returns the totalTokens of the last assistant message", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", usage: { totalTokens: 100 } },
      { role: "user", content: "again" },
      { role: "assistant", usage: { totalTokens: 250 } },
    ];
    expect(extractLastUsageTotalTokens(messages)).toBe(250);
  });

  it("skips non-assistant messages at the end", () => {
    const messages = [
      { role: "assistant", usage: { totalTokens: 80 } },
      { role: "user", content: "follow up" },
    ];
    expect(extractLastUsageTotalTokens(messages)).toBe(80);
  });

  it("returns null when no assistant usage exists", () => {
    expect(extractLastUsageTotalTokens([{ role: "user", content: "hi" }])).toBeNull();
    expect(extractLastUsageTotalTokens([{ role: "assistant", content: "x" }])).toBeNull();
    expect(extractLastUsageTotalTokens([])).toBeNull();
  });

  it("ignores non-numeric totalTokens", () => {
    const messages = [{ role: "assistant", usage: { totalTokens: "nope" } }];
    expect(extractLastUsageTotalTokens(messages)).toBeNull();
  });
});

describe("computeSessionStatus", () => {
  it("uses the last assistant usage for currentTokens", () => {
    resolveModelByIdMock.mockReturnValueOnce({ id: "m", provider: "p", contextWindow: 1000 });
    const status = computeSessionStatus(
      [{ role: "assistant", usage: { totalTokens: 4242 } }],
      { ...baseProfile, model: "p/m" },
    );
    expect(status).toEqual({ currentTokens: 4242, contextWindowLimit: 1000 });
  });

  it("falls back to token estimate when no usage is present", () => {
    resolveModelByIdMock.mockReturnValueOnce({ id: "m", provider: "p", contextWindow: 1000 });
    const status = computeSessionStatus(
      [{ role: "user", content: "hello world" }],
      { ...baseProfile, model: "p/m" },
    );
    expect(status.currentTokens).toBeGreaterThan(0);
    expect(status.currentTokens).toBe(3);
    expect(status.contextWindowLimit).toBe(1000);
  });

  it("returns null contextWindowLimit when model cannot be resolved", () => {
    const status = computeSessionStatus([], baseProfile, undefined);
    expect(status.contextWindowLimit).toBeNull();
    expect(status.currentTokens).toBe(0);
  });
});
