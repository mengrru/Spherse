import type { MarketplaceProjectEntry } from "@spherse/contracts";

export function deriveCategories(entries: readonly MarketplaceProjectEntry[]): string[] {
  const categories: string[] = [];
  for (const entry of entries) {
    if (!categories.includes(entry.category)) categories.push(entry.category);
  }
  return categories;
}

export function filterByCategory(
  entries: readonly MarketplaceProjectEntry[],
  category: string | null,
): MarketplaceProjectEntry[] {
  if (category === null) return [...entries];
  return entries.filter((entry) => entry.category === category);
}
