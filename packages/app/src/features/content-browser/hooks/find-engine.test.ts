import { describe, expect, it } from "vitest";
import { buildRange, clearHighlight, collectText, findMatches, MAX_MATCHES } from "./find-engine";

describe("find-engine", () => {
  describe("findMatches", () => {
    it("returns no matches for an empty needle", () => {
      expect(findMatches("hello world", "").matches).toEqual([]);
    });

    it("counts case-insensitive, non-overlapping matches", () => {
      const { matches } = findMatches("Foo foo FOO", "foo");
      expect(matches).toHaveLength(3);
      expect(matches[0]).toEqual({ start: 0, end: 3 });
      expect(matches[2]).toEqual({ start: 8, end: 11 });
    });

    it("does not overlap matches", () => {
      const { matches } = findMatches("aaaa", "aa");
      expect(matches).toEqual([
        { start: 0, end: 2 },
        { start: 2, end: 4 },
      ]);
    });

    it("flags overLimit when matches exceed the cap", () => {
      const text = "a".repeat(MAX_MATCHES * 2 + 5);
      const capped = findMatches(text, "a");
      expect(capped.matches).toHaveLength(MAX_MATCHES);
      expect(capped.overLimit).toBe(true);

      const exact = findMatches("a".repeat(MAX_MATCHES), "a");
      expect(exact.matches).toHaveLength(MAX_MATCHES);
      expect(exact.overLimit).toBe(false);
    });

    it("returns overLimit false when under the cap", () => {
      expect(findMatches("abc abc", "abc").overLimit).toBe(false);
    });
  });

  describe("collectText + buildRange", () => {
    it("walks text nodes and builds a range for a match in a single <pre>", () => {
      const root = document.createElement("div");
      root.innerHTML = "<pre>hello world hello</pre>";
      const { text, nodes } = collectText(root);
      expect(text).toBe("hello world hello");
      expect(nodes).toHaveLength(1);
      const range = buildRange(nodes, { start: 12, end: 17 });
      expect(range).not.toBeNull();
      expect(range!.toString()).toBe("hello");
    });

    it("locates matches across multiple rendered markdown elements", () => {
      const root = document.createElement("div");
      root.innerHTML = "<h1>Title</h1><p>foo <strong>bar</strong> foo</p>";
      const { text, nodes } = collectText(root);
      expect(text).toBe("Titlefoo bar foo");
      const matches = findMatches(text, "foo").matches;
      expect(matches).toHaveLength(2);
      const first = buildRange(nodes, matches[0])!.toString();
      const second = buildRange(nodes, matches[1])!.toString();
      expect(first).toBe("foo");
      expect(second).toBe("foo");
    });

    it("clearHighlight is a no-op when nothing was highlighted", () => {
      const holder = { current: null };
      expect(() => clearHighlight(holder)).not.toThrow();
      expect(holder.current).toBeNull();
    });
  });
});
