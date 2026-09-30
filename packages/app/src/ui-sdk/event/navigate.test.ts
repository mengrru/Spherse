import { describe, expect, it } from "vitest";
import { deriveNavigateEvent } from "./navigate";

describe("deriveNavigateEvent", () => {
  it("maps project index to welcome", () => {
    expect(deriveNavigateEvent("/project/p1", "")).toEqual({ kind: "welcome" });
  });

  it("maps chat routes and decodes the session id", () => {
    expect(deriveNavigateEvent("/project/p1/chat/s1", "")).toEqual({
      kind: "chat",
      sessionId: "s1",
    });
    expect(deriveNavigateEvent("/project/p1/chat/s%201", "")).toEqual({
      kind: "chat",
      sessionId: "s 1",
    });
  });

  it("maps content routes with a path query to file", () => {
    expect(
      deriveNavigateEvent("/project/p1/content", "?path=todo%2F%E4%BA%8B%E5%8A%A1%E7%B0%BF.html"),
    ).toEqual({ kind: "file", path: "todo/事务簿.html" });
  });

  it("returns null for transient content routes without a path", () => {
    expect(deriveNavigateEvent("/project/p1/content", "")).toBeNull();
    expect(deriveNavigateEvent("/project/p1/content", "?other=1")).toBeNull();
  });

  it("maps browser routes with a url query", () => {
    expect(deriveNavigateEvent("/project/p1/browser", "?url=http%3A%2F%2Flocalhost%3A3000")).toEqual({
      kind: "browser",
      url: "http://localhost:3000",
    });
  });

  it("returns null for transient browser routes without a url or with a non-loopback url", () => {
    expect(deriveNavigateEvent("/project/p1/browser", "")).toBeNull();
    expect(
      deriveNavigateEvent("/project/p1/browser", "?url=https%3A%2F%2Fexample.com%2F"),
    ).toBeNull();
  });

  it("ignores unrelated query params like messageId", () => {
    expect(deriveNavigateEvent("/project/p1/chat/s1", "?messageId=m5")).toEqual({
      kind: "chat",
      sessionId: "s1",
    });
  });

  it("returns null outside project routes and for unknown sub routes", () => {
    expect(deriveNavigateEvent("/", "")).toBeNull();
    expect(deriveNavigateEvent("/project/p1/unknown", "")).toBeNull();
    expect(deriveNavigateEvent("/project/p1/chat/s1/extra", "")).toBeNull();
  });
});
