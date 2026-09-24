import { describe, it, expect, vi } from "vitest";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { webSearchCapability } from "../../capabilities/web-search/index.js";
import type { SessionView } from "../../kernel/ports.js";

function viewWith(tools: string[] | undefined): SessionView {
  return { agentId: "a1", profile: { id: "a1", name: "A", slug: "a", tools } } as unknown as SessionView;
}

const context = {
  systemPrompt: "sys",
  messages: [],
  tools: [
    { name: "read_file", description: "", parameters: {} },
    { name: "web_search", description: "", parameters: {} },
  ],
};

function decorate(key: string | undefined, tools: string[] | undefined) {
  const capability = webSearchCapability({ getApiKey: () => key });
  const decorator = capability.streamDecorators![0](viewWith(tools));
  const base = vi.fn((() => undefined) as unknown as StreamFn);
  return { decorated: decorator ? decorator(base as unknown as StreamFn) : undefined, base };
}

function toolNamesSeen(base: ReturnType<typeof vi.fn>): string[] {
  const ctx = base.mock.calls[0][1] as { tools: Array<{ name: string }> };
  return ctx.tools.map((t) => t.name);
}

describe("webSearchCapability", () => {
  it("provides the web_search tool regardless of key", () => {
    const capability = webSearchCapability({ getApiKey: () => undefined });
    const tools = capability.tools!({} as never);
    expect(tools.map((t) => t.name)).toEqual(["web_search"]);
  });

  it("does not decorate when the profile does not enable web_search", () => {
    expect(decorate(undefined, ["read_file"]).decorated).toBeUndefined();
    expect(decorate(undefined, undefined).decorated).toBeUndefined();
  });

  it("hides web_search from the model when no key is configured", () => {
    const { decorated, base } = decorate(undefined, ["read_file", "web_search"]);
    void decorated!({} as never, context as never, undefined);
    expect(toolNamesSeen(base)).toEqual(["read_file"]);
    expect(context.tools).toHaveLength(2);
  });

  it("keeps web_search when a key is configured", () => {
    const { decorated, base } = decorate("sk-1", ["read_file", "web_search"]);
    void decorated!({} as never, context as never, undefined);
    expect(toolNamesSeen(base)).toEqual(["read_file", "web_search"]);
  });

  it("re-evaluates the key on every call", () => {
    let key: string | undefined;
    const capability = webSearchCapability({ getApiKey: () => key });
    const base = vi.fn((() => undefined) as unknown as StreamFn);
    const decorated = capability.streamDecorators![0](viewWith(["web_search"]))!(base as unknown as StreamFn);
    void decorated({} as never, context as never, undefined);
    key = "sk-2";
    void decorated({} as never, context as never, undefined);
    expect((base.mock.calls[0][1] as { tools: unknown[] }).tools).toHaveLength(1);
    expect((base.mock.calls[1][1] as { tools: unknown[] }).tools).toHaveLength(2);
  });
});
