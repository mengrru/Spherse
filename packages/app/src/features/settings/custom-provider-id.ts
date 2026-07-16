export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "provider";
}

export function generateCustomProviderId(name: string, existing: Iterable<string>): string {
  const existingSet = new Set(existing);
  const base = `custom-${slugify(name)}`;
  if (!existingSet.has(base)) return base;
  let n = 2;
  while (existingSet.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
