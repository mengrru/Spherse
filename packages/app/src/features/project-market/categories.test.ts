import { describe, expect, it } from "vitest";
import type { MarketplaceProjectEntry } from "@spherse/contracts";
import { deriveCategories, filterByCategory } from "./categories";

function entry(name: string, category: string): MarketplaceProjectEntry {
  return {
    name,
    description: `${name} description`,
    version: "1.0.0",
    category,
    zipUrl: `https://marketplace.test/${name}.zip`,
    size: 10,
    updatedAt: "2026-09-19T00:00:00Z",
  };
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
});
