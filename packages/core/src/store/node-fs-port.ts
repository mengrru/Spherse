import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type { FsEntry, FsPort, FsStat, FsWatchEvent } from "./fs-port.js";

function toPosix(rel: string): string {
  return rel.split(path.sep).join("/");
}

function assertRelInside(rel: string): string {
  if (path.isAbsolute(rel)) throw new Error(`FsPort rejects absolute path: ${rel}`);
  const normalized = path.normalize(rel);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`FsPort rejects escaping path: ${rel}`);
  }
  return normalized;
}

export class NodeFsPort implements FsPort {
  readonly capabilities = { atomicRename: true, watch: true };
  private readonly root: string;

  constructor(projectRoot: string) {
    this.root = path.resolve(projectRoot);
  }

  private abs(rel: string): string {
    return path.join(this.root, assertRelInside(rel));
  }

  async readFile(rel: string): Promise<string> {
    return fs.readFile(this.abs(rel), "utf-8");
  }

  async readBinaryFile(rel: string): Promise<Uint8Array> {
    const buffer = await fs.readFile(this.abs(rel));
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  async writeFile(rel: string, content: string): Promise<void> {
    await fs.writeFile(this.abs(rel), content, "utf-8");
  }

  async writeBinaryFile(rel: string, data: Uint8Array): Promise<void> {
    await fs.writeFile(this.abs(rel), data);
  }

  async writeFileIfMissing(rel: string, content: string): Promise<boolean> {
    try {
      const handle = await fs.open(this.abs(rel), "wx");
      await handle.writeFile(content, "utf-8");
      await handle.close();
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw err;
    }
  }

  async appendFile(rel: string, content: string): Promise<void> {
    await fs.appendFile(this.abs(rel), content, "utf-8");
  }

  async mkdirp(rel: string): Promise<void> {
    await fs.mkdir(this.abs(rel), { recursive: true });
  }

  async readdir(rel: string): Promise<FsEntry[]> {
    const dirents = await fs.readdir(this.abs(rel), { withFileTypes: true });
    return dirents.map((dirent) => ({ name: dirent.name, isDirectory: dirent.isDirectory() }));
  }

  async stat(rel: string): Promise<FsStat | null> {
    try {
      const s = await fs.stat(this.abs(rel));
      return {
        isFile: s.isFile(),
        isDirectory: s.isDirectory(),
        size: s.size,
        mtime: s.mtimeMs,
        id: `${s.dev}:${s.ino}`,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async unlink(rel: string): Promise<void> {
    await fs.rm(this.abs(rel), { force: true });
  }

  async rm(rel: string, options: { recursive: boolean }): Promise<void> {
    await fs.rm(this.abs(rel), { force: true, recursive: options.recursive });
  }

  async rename(from: string, to: string): Promise<void> {
    await fs.rename(this.abs(from), this.abs(to));
  }

  async copyFile(from: string, to: string): Promise<void> {
    await fs.copyFile(this.abs(from), this.abs(to));
  }

  async copyTree(from: string, to: string): Promise<void> {
    await fs.cp(this.abs(from), this.abs(to), { recursive: true, force: true });
  }

  watch(rel: string, onChange: (event: FsWatchEvent) => void): () => void {
    const absRoot = this.abs(rel);
    const seen = new Map<string, "file" | "dir" | null>();
    let ready = false;
    let closed = false;
    const scan = async (dir: string, prefix: string): Promise<void> => {
      const dirents = await fs.readdir(dir, { withFileTypes: true });
      for (const dirent of dirents) {
        const relPath = prefix === "" ? dirent.name : `${prefix}/${dirent.name}`;
        seen.set(relPath, dirent.isDirectory() ? "dir" : "file");
        if (dirent.isDirectory()) {
          await scan(path.join(dir, dirent.name), relPath);
        }
      }
    };
    void scan(absRoot, "")
      .catch(() => undefined)
      .then(() => {
        ready = true;
      });
    const watcher = fsSync.watch(absRoot, { recursive: true }, (_eventType, filename) => {
      if (!ready || closed || !filename) return;
      const abs = path.join(absRoot, String(filename));
      const relPath = toPosix(path.relative(this.root, abs));
      fs.stat(abs)
        .then((s) => {
          const previous = seen.get(relPath);
          const current = s.isFile() ? "file" : "dir";
          const kind: FsWatchEvent["kind"] = previous === null || previous === undefined ? "add" : "change";
          seen.set(relPath, current);
          onChange({ relPath, kind });
        })
        .catch(() => {
          const previous = seen.get(relPath);
          seen.set(relPath, null);
          if (previous !== null && previous !== undefined) {
            onChange({ relPath, kind: "unlink" });
          }
        });
    });
    return () => {
      closed = true;
      watcher.close();
    };
  }
}
