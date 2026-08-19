import { describe, expect, it, vi } from "vitest";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { timePerceptionCapability } from "../../capabilities/time-perception/index.js";
import { composeStreamFn, streamDecoratorsFor } from "../../session/agent-assembly.js";

function viewWith(timePerception?: object) {
  return {
    agentId: "a1",
    profile: { id: "a1", name: "A", slug: "a", timePerception },
    projectStore: {},
    stores: {},
  } as never;
}

describe("time-perception capability", () => {
  it("contributes no decorator and no block when disabled or absent", async () => {
    const capability = timePerceptionCapability();
    expect(streamDecoratorsFor([capability], viewWith(undefined))).toHaveLength(0);
    expect(streamDecoratorsFor([capability], viewWith({ enabled: false, epochMs: 0, startMs: 0, flowRate: 60 }))).toHaveLength(0);
    const blocks = await capability.contextBlocks!(viewWith(undefined));
    expect(blocks).toEqual([]);
  });

  it("decorator injects <time> prefix into outgoing messages", async () => {
    const capability = timePerceptionCapability();
    const config = { enabled: true, epochMs: 0, startMs: 0, flowRate: 60, timeZone: "UTC" };
    const decorators = streamDecoratorsFor([capability], viewWith(config));
    expect(decorators).toHaveLength(1);

    const base: StreamFn = vi.fn(async () => ({} as never)) as never;
    const wrapped = decorators[0](base);

    const context = {
      messages: [{ role: "user", content: "hi", timestamp: 1 }],
    } as never;
    await wrapped({ id: "m", provider: "p", api: "openai-completions" } as never, context, undefined);

    const passed = (base as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const first = passed.messages[0] as { content: string | Array<{ text?: string }> };
    const text = typeof first.content === "string" ? first.content : first.content[0]?.text ?? "";
    expect(text).toContain("<time>");
  });

  it("composes through composeStreamFn after the retry layer", () => {
    const catalog = {
      getChatStreamFn: vi.fn(() => vi.fn(async () => ({}) as never)),
    };
    const capability = timePerceptionCapability();
    const config = { enabled: true, epochMs: 0, startMs: 0, flowRate: 60 };
    const fn = composeStreamFn(
      catalog as never,
      undefined,
      streamDecoratorsFor([capability], viewWith(config)),
    );
    expect(typeof fn).toBe("function");
    expect(catalog.getChatStreamFn).toHaveBeenCalledTimes(1);
  });

  it("multiple stream decorators compose onion-style: later registration wraps outermost", () => {
    const order: string[] = [];
    const outer = (base: StreamFn) => ((...args: Parameters<StreamFn>) => (order.push("outer"), base(...args))) as StreamFn;
    const inner = (base: StreamFn) => ((...args: Parameters<StreamFn>) => (order.push("inner"), base(...args))) as StreamFn;

    const capA = { id: "a", streamDecorators: [() => outer] };
    const capB = { id: "b", streamDecorators: [() => inner] };
    const decorators = streamDecoratorsFor([capA, capB] as never, viewWith(undefined));
    expect(decorators).toHaveLength(2);

    let fn: StreamFn = async () => ({}) as never;
    for (const decorate of decorators) fn = decorate(fn);
    void fn({ id: "m", provider: "p", api: "x" } as never, { messages: [] } as never, undefined);
    expect(order).toEqual(["inner", "outer"]);
  });
});
