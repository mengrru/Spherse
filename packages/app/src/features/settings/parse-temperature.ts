export function parseTemperature(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  if (Number.isNaN(n) || n < 0) return undefined;
  return n;
}
