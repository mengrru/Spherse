import { describe, expect, it, vi } from "vitest";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { timePerceptionCapability } from "../../capabilities/time-perception/index.js";
import {
  composeStreamFn,
  previewTransformsFor,
  streamDecoratorsFor,
} from "../../session/agent-assembly.js";
function viewWith(timePerception?: object) {
  return {
    agentId: "a1",
    profile: { id: "a1", name: "A", slug: "a", timePerception },
    projectStore: {},
    stores: {},
  } as never;
}

describe("time-perception capability", () => {
  it("contributes no decorator, no preview and no block when disabled or absent", async () => {
    const capability = timePerceptionCapability();
    expect(streamDecoratorsFor([capability], viewWith(undefined))).toHaveLength(0);
    expect(streamDecoratorsFor([capability], viewWith({ enabled: false, epochMs: 0, startMs: 0, flowRate: 60 }))).toHaveLength(0);
    expect(previewTransformsFor([capability], viewWith(undefined))).toHaveLength(0);
    expect(previewTransformsFor([capability], viewWith({ enabled: false, epochMs: 0, startMs: 0, flowRate: 60 }))).toHaveLength(0);
    const blocks = await capability.contextBlocks!(viewWith(undefined));
    expect(blocks).toEqual([]);
  });

  it("preview transform mirrors the wire decorator output", async () => {
    const capability = timePerceptionCapability();
    const config = { enabled: true, epochMs: 0, startMs: 0, flowRate: 60, timeZone: "UTC" };
    const view = viewWith(config);
    const decorators = streamDecoratorsFor([capability], view);
    expect(decorators).toHaveLength(1);

    const messages = [
      { role: "user", content: "hello", timestamp: 100 },
      { role: "assistant", content: "hi", timestamp: 200 },
      { role: "user", content: [{ type: "text", text: "block" }], timestamp: 300 },
    ];

    let captured: { messages: unknown } | undefined;
    const base: StreamFn = vi.fn((_model, context) => {
      captured = context as { messages: unknown };
      return {} as never;
    }) as never;
    const wrapped = decorators[0](base);
    await wrapped({ id: "m", provider: "p", api: "x" } as never, { messages } as never, undefined);

    const previews = previewTransformsFor([capability], view);
    expect(previews).toHaveLength(1);
    expect(previews[0](messages as never)).toEqual(captured!.messages);
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
    const firstRegistered = (base: StreamFn) =>
      ((...args: Parameters<StreamFn>) => (order.push("first-registered"), base(...args))) as StreamFn;
    const lastRegistered = (base: StreamFn) =>
      ((...args: Parameters<StreamFn>) => (order.push("last-registered"), base(...args))) as StreamFn;

    const capA = { id: "a", streamDecorators: [() => firstRegistered] };
    const capB = { id: "b", streamDecorators: [() => lastRegistered] };
    const decorators = streamDecoratorsFor([capA, capB] as never, viewWith(undefined));
    expect(decorators).toHaveLength(2);

    let fn: StreamFn = async () => ({}) as never;
    for (const decorate of decorators) fn = decorate(fn);
    void fn({ id: "m", provider: "p", api: "x" } as never, { messages: [] } as never, undefined);
    expect(order).toEqual(["last-registered", "first-registered"]);
  });

  it("preview transforms replay wire onion order for non-commuting rewrites", async () => {
    const prepend =
      (marker: string) => (messages: never[]) =>
        messages.map((msg) =>
          msg.role === "user"
            ? { ...msg, content: [{ type: "text", text: `${marker}${msg.content[0].text}` }] }
            : msg,
        );
    const capWith = (id: string, marker: string) => ({
      id,
      streamDecorators: [
        () => (base: StreamFn) =>
          ((model, context, options) =>
            base(model, { ...context, messages: prepend(marker)(context.messages as never[]) }, options)) as StreamFn,
      ],
      previewTransforms: [() => prepend(marker)],
    });

    const capabilityA = capWith("a", "A:");
    const capabilityB = capWith("b", "B:");
    const capabilities = [capabilityA, capabilityB] as never[];
    const view = viewWith(undefined);

    let wireMessages: unknown;
    const base: StreamFn = vi.fn((_model, context) => {
      wireMessages = (context as { messages: unknown }).messages;
      return {} as never;
    }) as never;
    const decorators = streamDecoratorsFor(capabilities, view);
    let fn = base;
    for (const decorate of decorators) fn = decorate(fn);
    const input = [{ role: "user", content: [{ type: "text", text: "msg" }], timestamp: 1 }];
    await fn({ id: "m", provider: "p", api: "x" } as never, { messages: input } as never, undefined);

    let projected = input as never[];
    for (const transform of previewTransformsFor(capabilities, view)) {
      projected = transform(projected) as never[];
    }

    // Wire onion: B (registered last) rewrites first, then A — final text "A:B:msg".
    expect((projected[0] as { content: Array<{ text: string }> }).content[0].text).toBe("A:B:msg");
    expect(projected).toEqual(wireMessages);
  });
});
