import { describe, it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import { jsonSchemaToTypebox } from "../../mcp/json-schema-to-typebox.js";

describe("jsonSchemaToTypebox", () => {
  it("converts primitive types", () => {
    expect(jsonSchemaToTypebox({ type: "string" })).toEqual(Type.String());
    expect(jsonSchemaToTypebox({ type: "number" })).toEqual(Type.Number());
    expect(jsonSchemaToTypebox({ type: "integer" })).toEqual(Type.Integer());
    expect(jsonSchemaToTypebox({ type: "boolean" })).toEqual(Type.Boolean());
  });

  it("converts enum into a literal union", () => {
    const schema = { enum: ["a", "b", "c"] };
    const result = jsonSchemaToTypebox(schema);
    expect(result).toEqual(Type.Union([Type.Literal("a"), Type.Literal("b"), Type.Literal("c")]));
  });

  it("filters non-literal enum values", () => {
    const schema = { enum: ["a", 1, null, undefined, {}] };
    const result = jsonSchemaToTypebox(schema) as { anyOf: unknown[] };
    expect(result.anyOf).toHaveLength(3);
  });

  it("converts arrays of a typed item", () => {
    const result = jsonSchemaToTypebox({ type: "array", items: { type: "string" } });
    expect(result).toEqual(Type.Array(Type.String()));
  });

  it("converts arrays without items to unknown[]", () => {
    const result = jsonSchemaToTypebox({ type: "array" });
    expect(result).toEqual(Type.Array(Type.Unknown()));
  });

  it("converts objects with required and optional properties", () => {
    const result = jsonSchemaToTypebox({
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "number" },
      },
      required: ["name"],
    }) as { properties: Record<string, unknown> };
    expect(result.properties.name).toEqual(Type.String());
    expect(result.properties.count).toEqual(Type.Optional(Type.Number()));
  });

  it("converts anyOf into a union", () => {
    const result = jsonSchemaToTypebox({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
    expect(result).toEqual(Type.Union([Type.String(), Type.Number()]));
  });

  it("picks the first non-null type when type is an array", () => {
    expect(jsonSchemaToTypebox({ type: ["string", "null"] })).toEqual(Type.String());
  });

  it("falls back to Unknown for non-object input", () => {
    expect(jsonSchemaToTypebox("nope")).toEqual(Type.Unknown());
  });

  it("falls back to Unknown for unrecognized type", () => {
    expect(jsonSchemaToTypebox({ type: "weird" })).toEqual(Type.Unknown());
  });
});
