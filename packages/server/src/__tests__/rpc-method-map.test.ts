import { describe, expect, it } from "vitest";
import { buildMethodRegistry } from "../rpc/methods/registry.js";
import { buildBaseMethodRegistry } from "@spherse/rpc/methods";
import { rpcMethodSchemas } from "@spherse/contracts";

describe("server rpc method map guard", () => {
  it("server-only methods are covered by the contract map", () => {
    const base = new Set(buildBaseMethodRegistry().keys());
    for (const key of [...buildMethodRegistry().keys()]) {
      if (base.has(key)) continue;
      expect(
        (rpcMethodSchemas as Record<string, unknown>)[key],
        `missing map entry for server method ${key}`,
      ).toBeDefined();
    }
  });
});
