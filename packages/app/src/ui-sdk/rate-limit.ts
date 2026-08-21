const MAX_CALLS_PER_MINUTE = 30;
const WINDOW_MS = 60_000;
const timestamps: number[] = [];

const UNLIMITED = typeof process !== "undefined" && process.env?.SPHERSE_E2E_RATE_LIMIT_OFF === "1";

export const RATE_LIMIT_WHITELIST: ReadonlySet<string> = new Set([
  "data.get",
  "data.keys",
  "data.entries",
]);

export function isRateLimitWhitelisted(action: string): boolean {
  return RATE_LIMIT_WHITELIST.has(action);
}

export function checkRateLimit(action: string): boolean {
  if (UNLIMITED || isRateLimitWhitelisted(action)) return true;
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  while (timestamps.length > 0 && timestamps[0] < cutoff) {
    timestamps.shift();
  }
  if (timestamps.length >= MAX_CALLS_PER_MINUTE) return false;
  timestamps.push(now);
  return true;
}

export function resetRateLimit(): void {
  timestamps.length = 0;
}
