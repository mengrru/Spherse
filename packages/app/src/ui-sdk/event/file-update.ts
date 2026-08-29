import type { FsWatchChangeEvent } from "@spherse/contracts";

export const FILE_UPDATE_DEBOUNCE_MS = 300;

export function normalizeEventPath(input: string): string | null {
  const normalized = input.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) return null;

  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join("/") : null;
}

export function parseFileUpdate(payload: unknown): FsWatchChangeEvent | null {
  const event = payload as Partial<FsWatchChangeEvent> | null;
  if (
    !event
    || (event.eventType !== "change" && event.eventType !== "rename")
    || typeof event.path !== "string"
  ) {
    return null;
  }
  const path = normalizeEventPath(event.path);
  return path ? { path, eventType: event.eventType } : null;
}

export class FileUpdateDebouncer {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  schedule(event: FsWatchChangeEvent, deliver: (event: FsWatchChangeEvent) => void): void {
    const existing = this.timers.get(event.path);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(event.path);
      deliver(event);
    }, FILE_UPDATE_DEBOUNCE_MS);
    this.timers.set(event.path, timer);
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
