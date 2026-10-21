import { describe, expect, it } from "vitest";
import { parseContract, schemas } from "../index.js";

describe("content contracts", () => {
  it("accepts a valid rename request", () => {
    expect(parseContract(schemas.contentRenameRequest, { to: "docs/new.md" })).toEqual({
      to: "docs/new.md",
    });
  });

  it("rejects a rename request with a missing or non-string destination", () => {
    expect(() => parseContract(schemas.contentRenameRequest, {})).toThrow(/Invalid payload/);
    expect(() => parseContract(schemas.contentRenameRequest, { to: 1 })).toThrow(/Invalid payload/);
  });
});
