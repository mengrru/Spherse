import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@earendil-works/pi-agent-core";
import { createLog, emptyLog, type MessageLog } from "../../kernel/message-log.js";
import { composeTurnHooks, type TurnHooks } from "../../kernel/turn-hooks.js";

const agent = {} as Agent;

function logWith(tag: string): MessageLog {
  return createLog([{ dbId: 1, message: { role: "user", content: tag, timestamp: 0 } as never }]);
}

describe("composeTurnHooks", () => {
  it("runs beforeTurn hooks in registration order", async () => {
    const order: string[] = [];
    const a: TurnHooks = { beforeTurn: async () => void order.push("a") };
    const b: TurnHooks = { beforeTurn: async () => void order.push("b") };
    await composeTurnHooks([a, b]).beforeTurn?.(agent);
    expect(order).toEqual(["a", "b"]);
  });

  it("threads afterTurn log transformations in registration order", async () => {
    const a: TurnHooks = {
      afterTurn: async (_agent, log) => {
        expect(log.entries).toHaveLength(1);
        return logWith("a-out");
      },
    };
    const b: TurnHooks = {
      afterTurn: async (_agent, log) => {
        expect((log.entries[0].message as { content: string }).content).toBe("a-out");
        return logWith("b-out");
      },
    };
    const result = await composeTurnHooks([a, b]).afterTurn!(agent, logWith("seed"));
    expect((result.entries[0].message as { content: string }).content).toBe("b-out");
  });

  it("returns the same log reference when no hook transforms it", async () => {
    const input = emptyLog();
    const result = await composeTurnHooks([]).afterTurn!(agent, input);
    expect(result).toBe(input);
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
    const passthrough: TurnHooks = { afterTurn: async (_a, log) => log };
    const observer: TurnHooks = {
      afterTurn: async (_a, log) => {
        expect(log).toBe(seed);
        return log;
      },
    };
    await composeTurnHooks([passthrough, observer]).afterTurn!(agent, seed);
  });

  it("mcp-style memo + compaction-style transform compose", async () => {
    let merged = false;
    const mcpLike: TurnHooks = {
      beforeTurn: async () => void (merged = true),
      onReload: () => void (merged = false),
    };
    let compacted = false;
    const compactionLike: TurnHooks = {
      afterTurn: async (_a, log) => {
        compacted = true;
        return log;
      },
    };
    const composed = composeTurnHooks([mcpLike, compactionLike]);
    await composed.beforeTurn?.(agent);
    expect(merged).toBe(true);
    await composed.afterTurn!(agent, emptyLog());
    expect(compacted).toBe(true);
    composed.onReload?.();
    expect(merged).toBe(false);
  });
});
