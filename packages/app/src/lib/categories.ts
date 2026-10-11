export function deriveCategories(entries: readonly { category: string }[]): string[] {
  const categories: string[] = [];
  for (const entry of entries) {
    if (!categories.includes(entry.category)) categories.push(entry.category);
  }
  return categories;
}

export function filterByCategory<T extends { category: string }>(
  entries: readonly T[],
  category: string | null,
): T[] {
  if (category === null) return [...entries];
  return entries.filter((entry) => entry.category === category);
}
