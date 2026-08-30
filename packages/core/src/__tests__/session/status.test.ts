import { describe, it, expect, vi } from "vitest";

const resolveModelByIdMock = vi.fn((modelId: string) => ({ id: modelId, provider: "x", contextWindow: 32768 }));

import {
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

describe("resolveContextWindow", () => {
  it("returns the contextWindow from the resolved model", () => {
    resolveModelByIdMock.mockReturnValueOnce({ id: "m", provider: "p", contextWindow: 200000 });
    expect(resolveContextWindow({ ...baseProfile, model: "p/m" }, resolveModelByIdMock)).toBe(200000);
  });

  it("returns null when no model can be resolved", () => {
    expect(resolveContextWindow(baseProfile, resolveModelByIdMock, undefined)).toBeNull();
  });

  it("returns null when resolveModelById throws", () => {
    resolveModelByIdMock.mockImplementationOnce(() => {
      throw new Error("unknown model");
    });
    expect(resolveContextWindow({ ...baseProfile, model: "p/missing" }, resolveModelByIdMock)).toBeNull();
  });

  it("falls back to the global default when the per-agent model is stale", () => {
    resolveModelByIdMock.mockImplementationOnce(() => {
      throw new Error("unknown model");
    });
    resolveModelByIdMock.mockReturnValueOnce({ id: "default", provider: "p", contextWindow: 128000 });
    expect(
      resolveContextWindow({ ...baseProfile, model: "p/stale" }, resolveModelByIdMock, "p/default"),
    ).toBe(128000);
  });

  it("prefers the per-agent model over the global default", () => {
    resolveModelByIdMock.mockReturnValueOnce({ id: "own", provider: "p", contextWindow: 64000 });
    expect(
      resolveContextWindow({ ...baseProfile, model: "p/own" }, resolveModelByIdMock, "p/default"),
    ).toBe(64000);
  });

  it("returns null when the resolved model lacks contextWindow", () => {
    resolveModelByIdMock.mockReturnValueOnce({ id: "m", provider: "p" });
    expect(resolveContextWindow({ ...baseProfile, model: "p/m" }, resolveModelByIdMock)).toBeNull();
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
      resolveModelByIdMock,
    );
    expect(status).toEqual({ currentTokens: 4242, contextWindowLimit: 1000 });
  });

  it("falls back to token estimate when no usage is present", () => {
    resolveModelByIdMock.mockReturnValueOnce({ id: "m", provider: "p", contextWindow: 1000 });
    const status = computeSessionStatus(
      [{ role: "user", content: "hello world" }],
      { ...baseProfile, model: "p/m" },
      resolveModelByIdMock,
    );
    expect(status.currentTokens).toBeGreaterThan(0);
    expect(status.currentTokens).toBe(3);
    expect(status.contextWindowLimit).toBe(1000);
  });

  it("returns null contextWindowLimit when model cannot be resolved", () => {
    const status = computeSessionStatus([], baseProfile, resolveModelByIdMock, undefined);
    expect(status.contextWindowLimit).toBeNull();
    expect(status.currentTokens).toBe(0);
  });
});
