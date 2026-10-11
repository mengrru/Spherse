import { describe, expect, it } from "vitest";
import { deriveCategories, filterByCategory } from "./categories";

interface Entry {
  name: string;
  category: string;
}

function entry(name: string, category: string): Entry {
  return { name, category };
}

describe("deriveCategories", () => {
  it("returns categories in first-appearance order without duplicates", () => {
    const entries = [entry("a", "游戏"), entry("b", "工具"), entry("c", "游戏")];
    expect(deriveCategories(entries)).toEqual(["游戏", "工具"]);
  });

  it("returns an empty list for empty entries", () => {
    expect(deriveCategories([])).toEqual([]);
  });
});

describe("filterByCategory", () => {
  const entries = [entry("a", "游戏"), entry("b", "工具"), entry("c", "游戏")];

  it("returns all entries for null category", () => {
    expect(filterByCategory(entries, null)).toEqual(entries);
  });

  it("returns only entries matching the selected category", () => {
    expect(filterByCategory(entries, "游戏").map((e) => e.name)).toEqual(["a", "c"]);
  });

  it("returns an empty list for an unknown category", () => {
    expect(filterByCategory(entries, "不存在")).toEqual([]);
  });

  it("preserves extra fields of arbitrary entry shapes", () => {
    const prompts = [
      { id: "a", category: "创作", content: "x" },
      { id: "b", category: "互动", content: "y" },
    ];
    expect(filterByCategory(prompts, "创作")).toEqual([{ id: "a", category: "创作", content: "x" }]);
  });
});
