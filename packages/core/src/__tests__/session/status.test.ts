import { describe, it, expect, vi } from "vitest";

const resolveModelByIdMock = vi.fn((modelId: string) => ({ id: modelId, provider: "x", contextWindow: 32768 }));

import {
  resolveContextWindow,
  extractLastUsageTotalTokens,
  computeSessionStatus,
  computeTurnStats,
} from "../../session/status.js";
import { deriveMessages } from "../../session/fold.js";
import { wrapDigestContent } from "../../context/compaction.js";
import type { SessionEvent } from "../../session/events.js";
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

  it("does not fall back to the global default when the per-agent model resolves but lacks contextWindow", () => {
    resolveModelByIdMock.mockReturnValueOnce({ id: "own", provider: "p" });
    expect(
      resolveContextWindow({ ...baseProfile, model: "p/own" }, resolveModelByIdMock, "p/default"),
    ).toBeNull();
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
    expect(status).toEqual({
      currentTokens: 4242,
      contextWindowLimit: 1000,
      cacheHitRate: null,
      turnInputTokens: null,
      turnCacheReadTokens: null,
      turnCacheWriteTokens: null,
      turnOutputTokens: null,
      userMessageCount: 0,
      messageCount: 1,
    });
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

function usage(partial: Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number }>) {
  const input = partial.input ?? 0;
  const output = partial.output ?? 0;
  const cacheRead = partial.cacheRead ?? 0;
  const cacheWrite = partial.cacheWrite ?? 0;
  return { input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite };
}

describe("computeTurnStats", () => {
  it("sums usage from the last turn only", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "assistant", usage: usage({ input: 900, cacheRead: 100, cacheWrite: 50, output: 20 }) },
      { role: "user", content: "second" },
      { role: "assistant", usage: usage({ input: 100, cacheRead: 300, output: 40 }) },
      { role: "toolResult", toolCallId: "t1", content: [] },
      { role: "assistant", usage: usage({ input: 50, cacheRead: 700, cacheWrite: 10, output: 5 }) },
    ];
    const stats = computeTurnStats(messages);
    expect(stats.turnInputTokens).toBe(150);
    expect(stats.turnCacheReadTokens).toBe(1000);
    expect(stats.turnCacheWriteTokens).toBe(10);
    expect(stats.turnOutputTokens).toBe(45);
    expect(stats.cacheHitRate).toBeCloseTo(1000 / 1150);
    expect(stats.userMessageCount).toBe(2);
    expect(stats.messageCount).toBe(6);
  });

  it("computes 0% when nothing was read from cache", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", usage: usage({ input: 200, output: 10 }) },
    ];
    expect(computeTurnStats(messages).cacheHitRate).toBe(0);
  });

  it("computes 100% when all reads hit the cache", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", usage: usage({ cacheRead: 400, output: 10 }) },
    ];
    expect(computeTurnStats(messages).cacheHitRate).toBe(1);
  });

  it("returns null stats when no assistant message carries a usage breakdown", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "legacy reply" }] },
      { role: "user", content: "again" },
      { role: "assistant", usage: { totalTokens: 4242 } },
    ];
    const stats = computeTurnStats(messages);
    expect(stats.cacheHitRate).toBeNull();
    expect(stats.turnInputTokens).toBeNull();
    expect(stats.turnCacheReadTokens).toBeNull();
    expect(stats.turnCacheWriteTokens).toBeNull();
    expect(stats.turnOutputTokens).toBeNull();
  });

  it("returns null hit rate but measured output when cacheRead and input are both zero", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", usage: usage({ output: 12 }) },
    ];
    const stats = computeTurnStats(messages);
    expect(stats.cacheHitRate).toBeNull();
    expect(stats.turnInputTokens).toBe(0);
    expect(stats.turnOutputTokens).toBe(12);
  });

  it("degrades to the whole transcript when no user message exists", () => {
    const messages = [
      { role: "assistant", usage: usage({ input: 60, cacheRead: 140 }) },
      { role: "toolResult", toolCallId: "t1", content: [] },
      { role: "assistant", usage: usage({ input: 40, cacheRead: 60 }) },
    ];
    const stats = computeTurnStats(messages);
    expect(stats.turnInputTokens).toBe(100);
    expect(stats.turnCacheReadTokens).toBe(200);
    expect(stats.cacheHitRate).toBeCloseTo(200 / 300);
    expect(stats.userMessageCount).toBe(0);
    expect(stats.messageCount).toBe(3);
  });

  it("does not count compaction digests as user messages but keeps them in totals", () => {
    const messages = [
      { role: "user", content: wrapDigestContent("summary") },
      { role: "assistant", usage: usage({ input: 10, cacheRead: 90 }) },
    ];
    const stats = computeTurnStats(messages);
    expect(stats.userMessageCount).toBe(0);
    expect(stats.messageCount).toBe(2);
    expect(stats.turnCacheReadTokens).toBe(90);
  });

  it("treats a trailing digest as the turn boundary", () => {
    const digestMessage = { role: "user", content: wrapDigestContent("summary") };
    const messages = [
      { role: "user", content: "old" },
      { role: "assistant", usage: usage({ input: 500, cacheRead: 500 }) },
      digestMessage,
    ];
    const stats = computeTurnStats(messages);
    expect(stats.cacheHitRate).toBeNull();
    expect(stats.turnInputTokens).toBeNull();
  });
});

describe("computeTurnStats over derived event log", () => {
  function ev(type: string, data: unknown, seq: number): SessionEvent {
    return { type, seq, time: 0, data } as SessionEvent;
  }

  function userEvent(text: string, seq: number): SessionEvent {
    return ev("user/message", { message: { role: "user", content: text } }, seq);
  }

  function assistantEvent(seq: number): SessionEvent {
    return ev(
      "assistant/message",
      {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          usage: usage({ input: 100, cacheRead: 300 }),
        },
      },
      seq,
    );
  }

  it("excludes retried assistant messages from stats", () => {
    const events = [
      userEvent("hi", 0),
      assistantEvent(1),
      ev("turn/retried", { abandonedSeqs: [1] }, 2),
      assistantEvent(3),
    ];
    const stats = computeTurnStats(deriveMessages(events));
    expect(stats.turnInputTokens).toBe(100);
    expect(stats.turnCacheReadTokens).toBe(300);
    expect(stats.messageCount).toBe(2);
  });

  it("excludes withdrawn turns from stats", () => {
    const events = [
      userEvent("first", 0),
      assistantEvent(1),
      userEvent("second", 2),
      assistantEvent(3),
      ev("turn/withdrawn", { seq: 2 }, 4),
    ];
    const stats = computeTurnStats(deriveMessages(events));
    expect(stats.userMessageCount).toBe(1);
    expect(stats.messageCount).toBe(2);
    expect(stats.turnInputTokens).toBe(100);
  });

  it("resumes stats from a compaction digest replacement", () => {
    const events = [
      userEvent("first", 0),
      assistantEvent(1),
      ev(
        "compaction/applied",
        { anchorSeq: 1, digestContent: "summary", excludedSeqs: [] },
        2,
      ),
    ];
    const messages = deriveMessages(events);
    const stats = computeTurnStats(messages);
    expect(stats.userMessageCount).toBe(0);
    expect(stats.messageCount).toBe(1);
    expect(stats.cacheHitRate).toBeNull();
  });
});
