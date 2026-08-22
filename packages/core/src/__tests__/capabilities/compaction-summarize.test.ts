import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { summarizeForCompaction, SUMMARY_INSTRUCTION } from "../../capabilities/compaction/summarize.js";
import { createSilentLogger } from "../../logger.js";

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

describe("SUMMARY_INSTRUCTION", () => {
  it("adapts preservation priorities to the conversation nature", () => {
    expect(SUMMARY_INSTRUCTION).toContain("task-oriented");
    expect(SUMMARY_INSTRUCTION).toContain("emotional companionship");
    expect(SUMMARY_INSTRUCTION).toContain("relationship trajectory");
    expect(SUMMARY_INSTRUCTION).toContain("unresolved emotional threads");
    expect(SUMMARY_INSTRUCTION).toContain('Do NOT strip these as "irrelevant exploration"');
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
      content: SUMMARY_INSTRUCTION,
    });
    expect((calls[0].options as { sessionId: string }).sessionId).toBe("session-1");
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
