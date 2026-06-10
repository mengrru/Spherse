const MAX_CALLS_PER_MINUTE = 10;
const WINDOW_MS = 60_000;
const timestamps: number[] = [];

export function checkRateLimit(): boolean {
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
