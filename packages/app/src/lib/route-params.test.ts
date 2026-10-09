import { describe, expect, it } from "vitest";
import { isIndexRoute, parseMessageIdParam, stripMessageId } from "./route-params";

describe("isIndexRoute", () => {
  it("matches the bare index route", () => {
    expect(isIndexRoute("/")).toBe(true);
  });

  it("matches the index route carrying deep-link params", () => {
    expect(isIndexRoute("/?base=https%3A%2F%2Fx&token=t&targetPath=%2Fproject%2Fp1")).toBe(true);
    expect(isIndexRoute("/?x=1")).toBe(true);
  });

  it("rejects project and other routes", () => {
    expect(isIndexRoute("/project/p1")).toBe(false);
    expect(isIndexRoute("/project/p1/chat/s1")).toBe(false);
  });
});

describe("parseMessageIdParam", () => {
  it("parses decimal seq strings including zero", () => {
    expect(parseMessageIdParam("0")).toBe(0);
    expect(parseMessageIdParam("42")).toBe(42);
  });

  it("rejects missing, blank and non-decimal values", () => {
    expect(parseMessageIdParam(null)).toBeNull();
    expect(parseMessageIdParam("")).toBeNull();
    expect(parseMessageIdParam("  ")).toBeNull();
    expect(parseMessageIdParam("1e2")).toBeNull();
    expect(parseMessageIdParam("0x10")).toBeNull();
    expect(parseMessageIdParam("-3")).toBeNull();
    expect(parseMessageIdParam("abc")).toBeNull();
  });
});

describe("stripMessageId", () => {
  it("keeps paths without the param untouched", () => {
    expect(stripMessageId("/project/p1/chat/s1", "")).toBe("/project/p1/chat/s1");
    expect(stripMessageId("/project/p1/content", "?path=a.md")).toBe("/project/p1/content?path=a.md");
  });

  it("removes messageId and keeps other params", () => {
    expect(stripMessageId("/p/chat/s", "?messageId=7")).toBe("/p/chat/s");
    expect(stripMessageId("/p/chat/s", "?messageId=7&x=1")).toBe("/p/chat/s?x=1");
    expect(stripMessageId("/p/chat/s", "?x=1&messageId=7")).toBe("/p/chat/s?x=1");
  });

  it("does not match similarly named params", () => {
    expect(stripMessageId("/p/chat/s", "?foomessageId=7")).toBe("/p/chat/s?foomessageId=7");
  });
});
