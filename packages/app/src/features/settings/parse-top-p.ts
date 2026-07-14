export function parseTopP(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  if (Number.isNaN(n) || n < 0 || n > 1) return undefined;
  return n;
}
