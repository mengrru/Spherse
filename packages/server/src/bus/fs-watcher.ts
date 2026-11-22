import { categorizePath } from "@spherse/core";
import type { PathCategory, FsPort, FsWatchEvent } from "@spherse/core";

const WATCHED_CATEGORIES: ReadonlySet<PathCategory> = new Set([
  "userFiles",
  "rootIndex",
  "changelog",
  "projectConfig",
  "projectTheme",
  "agentTheme",
  "skills",
]);

function shouldReport(filename: string): boolean {
  const segs = filename.replace(/\\/g, "/").split("/");
  if (segs.includes("node_modules") || segs.includes(".git")) return false;
  return WATCHED_CATEGORIES.has(categorizePath(filename));
}

export type FsWatchListener = (
  projectId: string,
  evt: { eventType: "rename" | "change"; path: string },
) => void;

interface ProjectFsWatcher {
  closer: () => void;
  listeners: Set<FsWatchListener>;
}

const watchers = new Map<string, ProjectFsWatcher>();

function toBusEventType(kind: FsWatchEvent["kind"]): "rename" | "change" {
  return kind === "change" ? "change" : "rename";
}

export function acquireFsWatch(
  fsPort: FsPort,
  projectId: string,
  listener: FsWatchListener,
): { ok: true } | { ok: false; error: Error } {
  const existing = watchers.get(projectId);
  if (existing) {
    existing.listeners.add(listener);
    return { ok: true };
  }

  if (!fsPort.capabilities.watch || typeof fsPort.watch !== "function") {
    return { ok: false, error: new Error("fs watch is not supported by the storage backend") };
  }

  let closer: () => void;
  try {
    closer = fsPort.watch("", (event) => {
      if (!shouldReport(event.relPath)) return;
      const entry = watchers.get(projectId);
      if (!entry) return;
      const evt = { eventType: toBusEventType(event.kind), path: event.relPath };
      for (const l of entry.listeners) {
        l(projectId, evt);
      }
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
  }

  watchers.set(projectId, { closer, listeners: new Set([listener]) });
  return { ok: true };
}

export function releaseFsWatch(projectId: string, listener: FsWatchListener): void {
  const entry = watchers.get(projectId);
  if (!entry) return;
  entry.listeners.delete(listener);
  if (entry.listeners.size === 0) {
    watchers.delete(projectId);
    entry.closer();
  }
}
