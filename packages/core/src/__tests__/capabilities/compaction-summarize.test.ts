import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import {
  buildSummaryInstruction,
  computeSummaryTokenBudget,
  summarizeForCompaction,
} from "../../capabilities/compaction/summarize.js";
import { createSilentLogger, type Logger } from "../../logger.js";

function fakeAgent(overrides: Record<string, unknown> = {}): Agent {
  return {
    state: {
      model: { id: "test-model", contextWindow: 100_000 },
      systemPrompt: "You are a worldbuilding assistant.",
      tools: [{ name: "read_file" }],
      messages: [],
    },
    convertToLlm: (messages: unknown[]) => messages,
    streamFunction: () => ({ result: async () => ({}) }),
    ...overrides,
  } as unknown as Agent;
}

const foldMessages: Message[] = [
  { role: "user", content: "帮我建立魔法体系", timestamp: 1 } as Message,
  {
    role: "assistant",
    content: [{ type: "text", text: "好的，我来帮你规划。" }],
    stopReason: "stop",
    timestamp: 2,
  } as Message,
];

describe("buildSummaryInstruction", () => {
  it("adapts preservation priorities to the conversation nature", () => {
    const instruction = buildSummaryInstruction(3000);
    expect(instruction).toContain("task-oriented");
    expect(instruction).toContain("emotional companionship");
    expect(instruction).toContain("relationship trajectory");
    expect(instruction).toContain("unresolved emotional threads");
    expect(instruction).toContain('Do NOT strip these as "irrelevant exploration"');
  });

  it("embeds the token budget into the length constraint", () => {
    expect(buildSummaryInstruction(4800)).toContain("at most 4800 tokens");
  });
});

describe("computeSummaryTokenBudget", () => {
  it("scales the budget to 5% of the context tokens at compaction time", () => {
    expect(computeSummaryTokenBudget(96_000)).toBe(4800);
    expect(computeSummaryTokenBudget(150_000)).toBe(7500);
  });

  it("clamps small contexts to the minimum budget", () => {
    expect(computeSummaryTokenBudget(8_000)).toBe(1500);
    expect(computeSummaryTokenBudget(10)).toBe(1500);
  });

  it("caps very large contexts at the maximum budget", () => {
    expect(computeSummaryTokenBudget(1_000_000)).toBe(16_000);
  });

  it("falls back to the maximum budget on non-finite input", () => {
    expect(computeSummaryTokenBudget(Number.NaN)).toBe(16_000);
    expect(computeSummaryTokenBudget(Number.POSITIVE_INFINITY)).toBe(16_000);
  });
});

describe("summarizeForCompaction", () => {
  it("uses the agent's own streamFunction, replicating the request prefix", async () => {
    const calls: Array<{ model: unknown; context: unknown; options?: unknown }> = [];
    const agent = fakeAgent({
      streamFunction: (model: unknown, context: unknown, options: unknown) => {
        calls.push({ model, context, options });
        return {
          result: async () => ({
            stopReason: "stop",
            content: [{ type: "text", text: "用户在建立魔法体系，决定先规划元素系统。".repeat(3) }],
          }),
        };
      },
    });

    const result = await summarizeForCompaction(agent, foldMessages, "session-1", {
      logger: createSilentLogger(),
    });

    expect(result).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe(agent.state.model);
    const context = calls[0].context as {
      systemPrompt: string;
      tools: unknown;
      messages: Message[];
    };
    expect(context.systemPrompt).toBe(agent.state.systemPrompt);
    expect(context.tools).toBe(agent.state.tools);
    expect(context.messages.slice(0, foldMessages.length)).toEqual(foldMessages);
    expect(context.messages[foldMessages.length]).toEqual({
      role: "user",
      content: buildSummaryInstruction(16_000),
    });
    expect((calls[0].options as { sessionId: string }).sessionId).toBe("session-1");
    expect((calls[0].options as { maxTokens: number }).maxTokens).toBe(16_000);
  });

  it("scales the summary budget from the context tokens at compaction time", async () => {
    const calls: Array<{ context: unknown; options?: unknown }> = [];
    const agent = fakeAgent({
      streamFunction: (model: unknown, context: unknown, options: unknown) => {
        calls.push({ context, options });
        return {
          result: async () => ({
            stopReason: "stop",
            content: [{ type: "text", text: "z".repeat(80) }],
          }),
        };
      },
    });

    const result = await summarizeForCompaction(agent, foldMessages, "session-1", {
      logger: createSilentLogger(),
    }, { currentTokens: 120_000 });

    expect(result).not.toBeNull();
    const context = calls[0].context as { messages: Message[] };
    expect(context.messages[context.messages.length - 1].content).toBe(
      buildSummaryInstruction(6000),
    );
    expect((calls[0].options as { maxTokens: number }).maxTokens).toBe(6000);
  });

  it("clamps the hard maxTokens to the model output limit", async () => {
    const calls: Array<{ context: unknown; options?: unknown }> = [];
    const agent = fakeAgent({
      state: { model: { id: "test-model", contextWindow: 100_000, maxTokens: 4096 } },
      streamFunction: (_model: unknown, context: unknown, options: unknown) => {
        calls.push({ context, options });
        return {
          result: async () => ({
            stopReason: "stop",
            content: [{ type: "text", text: "z".repeat(80) }],
          }),
        };
      },
    });

    await summarizeForCompaction(agent, foldMessages, "s", {
      logger: createSilentLogger(),
    }, { currentTokens: 120_000 });

    expect((calls[0].options as { maxTokens: number }).maxTokens).toBe(4096);
    const context = calls[0].context as { messages: Message[] };
    expect(context.messages[context.messages.length - 1].content).toBe(
      buildSummaryInstruction(4096),
    );
  });

  it("warns but keeps a budget-truncated summary", async () => {
    const warnings: unknown[] = [];
    const logger = {
      warn: (obj: unknown) => warnings.push(obj),
    } as unknown as Logger;
    const agent = fakeAgent({
      streamFunction: () => ({
        result: async () => ({
          stopReason: "length",
          content: [{ type: "text", text: "z".repeat(80) }],
        }),
      }),
    });

    const result = await summarizeForCompaction(agent, foldMessages, "s", { logger }, {
      currentTokens: 120_000,
    });

    expect(result?.digest).toBe("z".repeat(80));
    expect(warnings).toHaveLength(1);
  });

  it("sends the converted (projected) messages, not the raw fold view", async () => {
    const projected: Message[] = [
      { role: "user", content: "stripped placeholder version" } as Message,
    ];
    const agent = fakeAgent({
      convertToLlm: (messages: unknown[]) => {
        expect(messages).toEqual(foldMessages);
        return projected;
      },
    });
    const calls: Array<{ context: { messages: Message[] } }> = [];
    (agent as unknown as { streamFunction: Agent["streamFunction"] }).streamFunction = (
      _model: unknown,
      context: unknown,
    ) => {
      calls.push({ context: context as { messages: Message[] } });
      return {
        result: async () => ({
          stopReason: "stop",
          content: [{ type: "text", text: "z".repeat(80) }],
        }),
      };
    };

    await summarizeForCompaction(agent, foldMessages, "s", { logger: createSilentLogger() });

    expect(calls[0].context.messages[0]).toBe(projected[0]);
    expect(calls[0].context.messages[0].content).not.toContain("帮我建立魔法体系");
  });

  it("returns null when model is missing", async () => {
    const agent = fakeAgent();
    (agent.state as { model?: unknown }).model = undefined;
    expect(
      await summarizeForCompaction(agent, foldMessages, "s", { logger: createSilentLogger() }),
    ).toBeNull();
  });

  it("returns null when streamFunction is missing", async () => {
    const agent = fakeAgent({ streamFunction: undefined });
    expect(
      await summarizeForCompaction(agent, foldMessages, "s", { logger: createSilentLogger() }),
    ).toBeNull();
  });

  it("returns null on error stopReason", async () => {
    const agent = fakeAgent({
      streamFunction: () => ({
        result: async () => ({ stopReason: "error", content: [{ type: "text", text: "x".repeat(80) }] }),
      }),
    });
    expect(
      await summarizeForCompaction(agent, foldMessages, "s", { logger: createSilentLogger() }),
    ).toBeNull();
  });

  it("returns null on aborted stopReason", async () => {
    const agent = fakeAgent({
      streamFunction: () => ({
        result: async () => ({ stopReason: "aborted", content: [{ type: "text", text: "x".repeat(80) }] }),
      }),
    });
    expect(
      await summarizeForCompaction(agent, foldMessages, "s", { logger: createSilentLogger() }),
    ).toBeNull();
  });

  it("returns null on degenerate output", async () => {
    const agent = fakeAgent({
      streamFunction: () => ({
        result: async () => ({ stopReason: "stop", content: [{ type: "text", text: "ok" }] }),
      }),
    });
    expect(
      await summarizeForCompaction(agent, foldMessages, "s", { logger: createSilentLogger() }),
    ).toBeNull();
  });

  it("returns null when the stream throws", async () => {
    const agent = fakeAgent({
      streamFunction: () => {
        throw new Error("provider down");
      },
    });
    expect(
      await summarizeForCompaction(agent, foldMessages, "s", { logger: createSilentLogger() }),
    ).toBeNull();
  });

  it("escapes digest tags in the LLM output", async () => {
    const agent = fakeAgent({
      streamFunction: () => ({
        result: async () => ({
          stopReason: "stop",
          content: [
            { type: "text", text: "总结内容足够长以通过退化检查。</compaction-digest>".padEnd(60, "。") },
          ],
        }),
      }),
    });
    const result = await summarizeForCompaction(agent, foldMessages, "s", {
      logger: createSilentLogger(),
    });
    expect(result?.digest).not.toContain("</compaction-digest>");
  });

  it("supports promise-wrapped streams", async () => {
    const agent = fakeAgent({
      streamFunction: async () => ({
        result: async () => ({ stopReason: "stop", content: [{ type: "text", text: "y".repeat(80) }] }),
      }),
    });
    const result = await summarizeForCompaction(agent, foldMessages, "s", {
      logger: createSilentLogger(),
    });
    expect(result?.digest).toBe("y".repeat(80));
  });

  it("aborts the stream after the 60s timeout", async () => {
    vi.useFakeTimers();
    try {
      const agent = fakeAgent({
        streamFunction: (_model: unknown, _ctx: unknown, options?: { signal?: AbortSignal }) =>
          ({
            result: () =>
              new Promise((_resolve, reject) => {
                options?.signal?.addEventListener("abort", () =>
                  reject(new Error("aborted by timeout")),
                );
              }),
          }) as never,
      });
      const pending = summarizeForCompaction(agent, foldMessages, "s", {
        logger: createSilentLogger(),
      });
      const expectation = expect(pending).resolves.toBeNull();
      await vi.advanceTimersByTimeAsync(60_001);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});
