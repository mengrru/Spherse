import { describe, expect, it } from "vitest";
import {
  isPathAtOrUnder,
  isTabTarget,
  normalizeTabTarget,
  pickNeighborKey,
  tabKey,
  tabUrl,
} from "./tab-target";

describe("tab-target", () => {
  it("builds stable keys per kind", () => {
    expect(tabKey({ kind: "chat", sessionId: "s1" })).toBe("chat:s1");
    expect(tabKey({ kind: "file", path: "notes/a.md" })).toBe("file:notes/a.md");
    expect(tabKey({ kind: "browser", url: "http://localhost:3000" })).toBe("browser:http://localhost:3000/");
  });

  it("normalizes file paths and browser urls so equivalent targets share a key", () => {
    expect(tabKey({ kind: "file", path: "./notes\\a.md" })).toBe(tabKey({ kind: "file", path: "notes/a.md" }));
    expect(tabKey({ kind: "browser", url: "http://localhost:3000/" })).toBe(
      tabKey({ kind: "browser", url: "http://localhost:3000" }),
    );
    expect(normalizeTabTarget({ kind: "browser", url: "not a url" })).toEqual({ kind: "browser", url: "not a url" });
  });

  it("builds route urls", () => {
    expect(tabUrl("p1", { kind: "chat", sessionId: "s1" })).toBe("/project/p1/chat/s1");
    expect(tabUrl("p1", { kind: "file", path: "a b/c.md" })).toBe("/project/p1/content?path=a%20b%2Fc.md");
    expect(tabUrl("p1", { kind: "browser", url: "http://localhost:3000/x" })).toBe(
      "/project/p1/browser?url=http%3A%2F%2Flocalhost%3A3000%2Fx",
    );
  });

  it("validates persisted targets", () => {
    expect(isTabTarget({ kind: "chat", sessionId: "s1" })).toBe(true);
    expect(isTabTarget({ kind: "file", path: "a.md" })).toBe(true);
    expect(isTabTarget({ kind: "browser", url: "http://localhost/" })).toBe(true);
    expect(isTabTarget({ kind: "chat", sessionId: "" })).toBe(false);
    expect(isTabTarget({ kind: "file" })).toBe(false);
    expect(isTabTarget({ kind: "other", path: "x" })).toBe(false);
    expect(isTabTarget(null)).toBe(false);
    expect(isTabTarget("chat:s1")).toBe(false);
  });

  it("matches a path at or under a deleted directory by segments", () => {
    expect(isPathAtOrUnder("notes/a.md", "notes/a.md")).toBe(true);
    expect(isPathAtOrUnder("notes/a.md", "notes")).toBe(true);
    expect(isPathAtOrUnder("notes/a.md", "notes/")).toBe(true);
    expect(isPathAtOrUnder("notes-old/a.md", "notes")).toBe(false);
    expect(isPathAtOrUnder("notes", "notes/a.md")).toBe(false);
    expect(isPathAtOrUnder("notes/a.md", "")).toBe(false);
  });

  it("picks the right neighbor first, then the left one", () => {
    expect(pickNeighborKey(["a", "b", "c"], "b")).toBe("c");
    expect(pickNeighborKey(["a", "b", "c"], "c")).toBe("b");
    expect(pickNeighborKey(["a"], "a")).toBeNull();
    expect(pickNeighborKey(["a"], "x")).toBeNull();
  });
});
