import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@earendil-works/pi-agent-core";
import { composeTurnHooks, type TurnEventAppender, type TurnHooks } from "../../kernel/turn-hooks.js";

const agent = {} as Agent;

function logWith(tag: string): TurnEventAppender {
  return {
    events: [{ type: "user/message", seq: 0, data: { message: { role: "user", content: tag, timestamp: 0 } } }],
    append: vi.fn(),
  };
}

describe("composeTurnHooks", () => {
  it("runs beforeTurn hooks in registration order", async () => {
    const order: string[] = [];
    const a: TurnHooks = { beforeTurn: async () => void order.push("a") };
    const b: TurnHooks = { beforeTurn: async () => void order.push("b") };
    await composeTurnHooks([a, b]).beforeTurn?.(agent);
    expect(order).toEqual(["a", "b"]);
  });

  it("passes the same event log to each afterTurn hook in order", async () => {
    const order: string[] = [];
    const a: TurnHooks = { afterTurn: async () => void order.push("a") };
    const b: TurnHooks = { afterTurn: async () => void order.push("b") };
    await composeTurnHooks([a, b]).afterTurn!(agent, logWith("seed"));
    expect(order).toEqual(["a", "b"]);
  });

  it("propagates onReload to every hook", () => {
    const a = { onReload: vi.fn() };
    const b = { onReload: vi.fn() };
    composeTurnHooks([a, b]).onReload?.();
    expect(a.onReload).toHaveBeenCalledTimes(1);
    expect(b.onReload).toHaveBeenCalledTimes(1);
  });

  it("a passthrough afterTurn keeps the incoming log for the next hook", async () => {
    const seed = logWith("seed");
    const passthrough: TurnHooks = { afterTurn: async (_a, log) => void log };
    const observer: TurnHooks = {
      afterTurn: async (_a, log) => {
        expect(log).toBe(seed);
      },
    };
    await composeTurnHooks([passthrough, observer]).afterTurn!(agent, seed);
  });

  it("mcp-style memo + compaction-style append compose", async () => {
    let merged = false;
    const mcpLike: TurnHooks = {
      beforeTurn: async () => void (merged = true),
      onReload: () => void (merged = false),
    };
    let compacted = false;
    const compactionLike: TurnHooks = {
      afterTurn: async () => void (compacted = true),
    };
    const composed = composeTurnHooks([mcpLike, compactionLike]);
    await composed.beforeTurn?.(agent);
    expect(merged).toBe(true);
    await composed.afterTurn!(agent, logWith("seed"));
    expect(compacted).toBe(true);
    composed.onReload?.();
    expect(merged).toBe(false);
  });
});
