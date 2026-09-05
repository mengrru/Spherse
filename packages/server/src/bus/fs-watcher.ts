import fs from "node:fs";
import { categorizePath } from "@spherse/core";
import type { PathCategory } from "@spherse/core";

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
  watcher: fs.FSWatcher;
  listeners: Set<FsWatchListener>;
  error: Error | null;
}

const watchers = new Map<string, ProjectFsWatcher>();

export function acquireFsWatch(
  projectRoot: string,
  projectId: string,
  listener: FsWatchListener,
): { ok: true } | { ok: false; error: Error } {
  const existing = watchers.get(projectId);
  if (existing) {
    existing.listeners.add(listener);
    return { ok: true };
  }

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(
      projectRoot,
      { recursive: true },
      (eventType, filename) => {
        if (!filename) return;
        if (!shouldReport(filename)) return;
        const entry = watchers.get(projectId);
        if (!entry) return;
        const evt = { eventType, path: filename };
        for (const l of entry.listeners) {
          l(projectId, evt);
        }
      },
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
  }

  const entry: ProjectFsWatcher = {
    watcher,
    listeners: new Set([listener]),
    error: null,
  };

  watcher.on("error", (err) => {
    entry.error = err instanceof Error ? err : new Error(String(err));
    watcher.close();
    entry.listeners.clear();
    watchers.delete(projectId);
  });

  watchers.set(projectId, entry);
  return { ok: true };
}

export function releaseFsWatch(projectId: string, listener: FsWatchListener): void {
  const entry = watchers.get(projectId);
  if (!entry) return;
  entry.listeners.delete(listener);
  if (entry.listeners.size === 0) {
    watchers.delete(projectId);
    entry.watcher.close();
  }
}
