import { describe, expect, it, vi } from "vitest";
import type { FsPort, FsWatchEvent } from "@spherse/core";
import { acquireFsWatch } from "../bus/fs-watcher.js";
import { releaseFsWatch } from "../bus/fs-watcher.js";

interface FakeWatch {
  emit: (event: FsWatchEvent) => void;
  close: ReturnType<typeof vi.fn>;
}

function createFakePort(options: { watchSupported?: boolean; throwOnWatch?: boolean } = {}) {
  const watches: FakeWatch[] = [];
  const port: FsPort = {
    capabilities: { atomicRename: true, watch: options.watchSupported ?? true },
    readFile: vi.fn(),
    readBinaryFile: vi.fn(),
    writeFile: vi.fn(),
    writeBinaryFile: vi.fn(),
    writeFileIfMissing: vi.fn(),
    appendFile: vi.fn(),
    mkdirp: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
    rm: vi.fn(),
    rename: vi.fn(),
    copyFile: vi.fn(),
    copyTree: vi.fn(),
    watch: options.throwOnWatch
      ? () => {
          throw new Error("watch boom");
        }
      : (_rel: string, onChange: (event: FsWatchEvent) => void) => {
          const fake: FakeWatch = {
            emit: onChange,
            close: vi.fn(),
          };
          watches.push(fake);
          return fake.close;
        },
  };
  return { port, watches };
}

describe("ProjectFsWatcher", () => {
  it("creates a single watcher for multiple acquires on the same projectId", () => {
    const { port, watches } = createFakePort();
    const listenerA = vi.fn();
    const listenerB = vi.fn();

    const r1 = acquireFsWatch(port, "p-single", listenerA);
    const r2 = acquireFsWatch(port, "p-single", listenerB);

    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });
    expect(watches.length).toBe(1);
  });

  it("closes the watcher and clears the map on equal releases", () => {
    const { port, watches } = createFakePort();
    const listenerA = vi.fn();
    const listenerB = vi.fn();

    acquireFsWatch(port, "p-release", listenerA);
    acquireFsWatch(port, "p-release", listenerB);

    releaseFsWatch("p-release", listenerA);
    expect(watches[0].close).not.toHaveBeenCalled();

    releaseFsWatch("p-release", listenerB);
    expect(watches[0].close).toHaveBeenCalledTimes(1);

    acquireFsWatch(port, "p-release", listenerA);
    expect(watches.length).toBe(2);
  });

  it("returns error and does not add listener when port watch throws", () => {
    const { port } = createFakePort({ throwOnWatch: true });
    const listenerA = vi.fn();
    const result = acquireFsWatch(port, "p-throw", listenerA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("watch boom");
  });

  it("degrades explicitly when the port lacks watch capability", () => {
    const { port } = createFakePort({ watchSupported: false });
    const listener = vi.fn();
    const result = acquireFsWatch(port, "p-nocap", listener);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("not supported");
  });

  it("maps port vocabulary to bus wire vocabulary and filters categories", () => {
    const { port, watches } = createFakePort();
    const listener = vi.fn();
    acquireFsWatch(port, "p-map", listener);

    watches[0].emit({ relPath: "AGENTS.md", kind: "change" });
    expect(listener).toHaveBeenCalledWith("p-map", { eventType: "change", path: "AGENTS.md" });

    watches[0].emit({ relPath: "AGENTS.md", kind: "add" });
    expect(listener).toHaveBeenCalledWith("p-map", { eventType: "rename", path: "AGENTS.md" });

    watches[0].emit({ relPath: "AGENTS.md", kind: "unlink" });
    expect(listener).toHaveBeenCalledWith("p-map", { eventType: "rename", path: "AGENTS.md" });

    watches[0].emit({ relPath: "node_modules/pkg/index.js", kind: "change" });
    watches[0].emit({ relPath: ".git/config", kind: "change" });
    expect(listener).toHaveBeenCalledTimes(3);
    releaseFsWatch("p-map", listener);
  });
});
