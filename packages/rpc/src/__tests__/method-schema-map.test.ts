import { describe, expect, it } from "vitest";
import { buildBaseMethodRegistry } from "../methods/registry.js";
import { rpcMethodSchemas } from "@spherse/contracts";

describe("rpc method schema map", () => {
  it("base registry params match the contract map (deep equality per method)", () => {
    const base = buildBaseMethodRegistry();
    const baseKeys = [...base.keys()];
    expect(baseKeys.length).toBeGreaterThan(50);
    for (const key of baseKeys) {
      const entry = base.get(key)!;
      const mapped = (rpcMethodSchemas as Record<string, { params: unknown; result: unknown }>)[key];
      expect(mapped, `missing map entry for ${key}`).toBeDefined();
      expect(entry.params, `params schema drift for ${key}`).toEqual(mapped.params);
    }
  });

  it("map has no keys outside the union of known registries", () => {
    const base = new Set(buildBaseMethodRegistry().keys());
    const serverOnly = new Set([
      "skills.create",
      "skills.list",
      "skills.listMarketplace",
      "skills.install",
      "skills.installMarketplace",
      "marketplace.projects",
      "marketplace.installProject",
      "marketplace.prompts",
    ]);
    const browserOnly = new Set([
      "attachments.upload",
      "attachments.delete",
      "browser.createProject",
      "browser.removeProject",
    ]);
    const known = new Set([...base, ...serverOnly, ...browserOnly]);
    for (const key of Object.keys(rpcMethodSchemas)) {
      expect(known.has(key), `map has stale key ${key}`).toBe(true);
    }
  });
});
