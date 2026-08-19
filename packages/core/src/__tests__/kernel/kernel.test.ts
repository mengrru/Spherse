import { describe, expect, it } from "vitest";
import { ConflictError } from "../../errors.js";
import { CapabilityRegistry, type Capability } from "../../kernel/capability.js";
import { createStoreRegistry } from "../../kernel/ports.js";
import { serializeBlocks, taggedBlock } from "../../kernel/context-block.js";

function cap(id: string): Capability {
  return { id };
}

describe("CapabilityRegistry", () => {
  it("registers and looks up capabilities by id", () => {
    const registry = new CapabilityRegistry();
    const fs = cap("fs");
    registry.register(fs);
    expect(registry.byId("fs")).toBe(fs);
    expect(registry.all()).toEqual([fs]);
    expect(registry.size).toBe(1);
  });

  it("rejects duplicate ids with ConflictError", () => {
    const registry = new CapabilityRegistry();
    registry.register(cap("memory"));
    expect(() => registry.register(cap("memory"))).toThrow(ConflictError);
  });
});

describe("StoreRegistry", () => {
  it("keeps global stores independent from agent-scoped stores", () => {
    const registry = createStoreRegistry();
    const globalStore = { name: "global" };
    registry.register("shared", globalStore);
    expect(registry.get("shared")).toBe(globalStore);
    expect(registry.forAgent("a1").get("shared")).toBeUndefined();
  });

  it("isolates agent scopes from each other", () => {
    const registry = createStoreRegistry();
    const storeA = { agent: "a" };
    registry.forAgent("a").set("memory", storeA);
    expect(registry.forAgent("a").get("memory")).toBe(storeA);
    expect(registry.forAgent("b").get("memory")).toBeUndefined();
  });

  it("set returns the stored value for one-liner lazy init", () => {
    const registry = createStoreRegistry();
    const created = registry.forAgent("a").set("memory", { opened: true });
    expect(created).toEqual({ opened: true });
  });

  it("clearAgent drops the whole agent scope", () => {
    const registry = createStoreRegistry();
    registry.forAgent("a").set("memory", {});
    registry.clearAgent("a");
    expect(registry.forAgent("a").get("memory")).toBeUndefined();
  });

  it("delete removes a single scoped store", () => {
    const registry = createStoreRegistry();
    registry.forAgent("a").set("memory", {});
    registry.forAgent("a").delete("memory");
    expect(registry.forAgent("a").get("memory")).toBeUndefined();
  });
});

describe("kernel ContextBlock", () => {
  it("renders tagged blocks and joins non-empty renders in order", () => {
    const text = serializeBlocks([
      taggedBlock("agent-profile", "hello"),
      null,
      taggedBlock("memory", "known facts"),
    ]);
    expect(text).toBe("<agent-profile>\nhello\n</agent-profile>\n\n<memory>\nknown facts\n</memory>");
  });

  it("returns empty string when nothing renders", () => {
    expect(serializeBlocks([null, { kind: "blank", render: () => " " }])).toBe("");
  });

  it("allows custom kinds without central registration", () => {
    const block = {
      kind: "custom-kind",
      render: () => "custom content",
    };
    expect(serializeBlocks([block])).toBe("custom content");
  });
});
