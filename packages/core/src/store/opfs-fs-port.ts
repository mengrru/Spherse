import type { FsEntry, FsPort, FsStat } from "./fs-port.js";

function assertRelInside(rel: string): string[] {
  if (rel.startsWith("/")) throw new Error(`FsPort rejects absolute path: ${rel}`);
  const segments: string[] = [];
  for (const part of rel.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) throw new Error(`FsPort rejects escaping path: ${rel}`);
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  if (segments.some((part) => part === "..")) throw new Error(`FsPort rejects escaping path: ${rel}`);
  return segments;
}

function dirnameSegments(segments: string[]): string[] {
  return segments.slice(0, -1);
}

export class OpfsFsPort implements FsPort {
  readonly capabilities = { atomicRename: false, watch: false };
  private readonly root: FileSystemDirectoryHandle;
  private readonly rootName: string;

  private constructor(root: FileSystemDirectoryHandle, rootName: string) {
    this.root = root;
    this.rootName = rootName;
  }

  static async open(rootDirName: string): Promise<OpfsFsPort> {
    const opfsRoot = await navigator.storage.getDirectory();
    const root = await opfsRoot.getDirectoryHandle(rootDirName, { create: true });
    return new OpfsFsPort(root, rootDirName);
  }

  async destroy(): Promise<void> {
    const opfsRoot = await navigator.storage.getDirectory();
    await opfsRoot.removeEntry(this.rootName, { recursive: true });
  }

  private async dirFor(segments: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let dir = this.root;
    for (const part of segments) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir;
  }

  private async fileFor(rel: string, create: boolean): Promise<FileSystemFileHandle> {
    const segments = assertRelInside(rel);
    const dir = await this.dirFor(dirnameSegments(segments), create);
    return dir.getFileHandle(segments[segments.length - 1], { create });
  }

  async readFile(relPath: string): Promise<string> {
    const handle = await this.fileFor(relPath, false);
    return (await handle.getFile()).text();
  }

  async readBinaryFile(relPath: string): Promise<Uint8Array> {
    const handle = await this.fileFor(relPath, false);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const handle = await this.fileFor(relPath, true);
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async writeBinaryFile(relPath: string, data: Uint8Array): Promise<void> {
    const handle = await this.fileFor(relPath, true);
    const writable = await handle.createWritable();
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    await writable.write(copy);
    await writable.close();
  }

  async writeFileIfMissing(relPath: string, content: string): Promise<boolean> {
    try {
      await this.fileFor(relPath, false);
      return false;
    } catch (err) {
      if ((err as DOMException)?.name !== "NotFoundError") throw err;
    }
    await this.writeFile(relPath, content);
    return true;
  }

  async appendFile(relPath: string, content: string): Promise<void> {
    const handle = await this.fileFor(relPath, true);
    let size = 0;
    try {
      size = (await handle.getFile()).size;
    } catch (err) {
      if ((err as DOMException)?.name !== "NotFoundError") throw err;
    }
    const writable = await handle.createWritable({ keepExistingData: true });
    await writable.write({ type: "write", position: size, data: content });
    await writable.close();
  }

  async mkdirp(relPath: string): Promise<void> {
    await this.dirFor(assertRelInside(relPath), true);
  }

  async readdir(relPath: string): Promise<FsEntry[]> {
    const dir = relPath === "" ? this.root : await this.dirFor(assertRelInside(relPath), false);
    const entries: FsEntry[] = [];
    for await (const handle of dir.values()) {
      entries.push({ name: handle.name, isDirectory: handle.kind === "directory" });
    }
    return entries;
  }

  async stat(relPath: string): Promise<FsStat | null> {
    const segments = assertRelInside(relPath);
    if (segments.length === 0) {
      return { isFile: false, isDirectory: true, size: 0, mtime: 0 };
    }
    const dir = await this.dirFor(dirnameSegments(segments), false);
    const name = segments[segments.length - 1];
    try {
      const file = await dir.getFileHandle(name);
      const blob = await file.getFile();
      return { isFile: true, isDirectory: false, size: blob.size, mtime: blob.lastModified };
    } catch (err) {
      const name_ = (err as DOMException)?.name;
      if (name_ !== "NotFoundError" && name_ !== "TypeMismatchError") throw err;
    }
    try {
      await dir.getDirectoryHandle(name);
      return { isFile: false, isDirectory: true, size: 0, mtime: 0 };
    } catch (err) {
      const name_ = (err as DOMException)?.name;
      if (name_ !== "NotFoundError" && name_ !== "TypeMismatchError") throw err;
      return null;
    }
  }

  async unlink(relPath: string): Promise<void> {
    const segments = assertRelInside(relPath);
    const dir = await this.dirFor(dirnameSegments(segments), false);
    try {
      await dir.removeEntry(segments[segments.length - 1]);
    } catch (err) {
      if ((err as DOMException)?.name !== "NotFoundError") throw err;
    }
  }

  async rm(relPath: string, options: { recursive: boolean }): Promise<void> {
    const segments = assertRelInside(relPath);
    if (segments.length === 0) return;
    const dir = await this.dirFor(dirnameSegments(segments), false);
    try {
      await dir.removeEntry(segments[segments.length - 1], { recursive: options.recursive });
    } catch (err) {
      if ((err as DOMException)?.name !== "NotFoundError") throw err;
    }
  }

  async rename(from: string, to: string): Promise<void> {
    await this.copyTree(from, to);
    await this.rm(from, { recursive: true });
  }

  async copyFile(from: string, to: string): Promise<void> {
    const data = await this.readBinaryFile(from);
    await this.writeBinaryFile(to, data);
  }

  async copyTree(from: string, to: string): Promise<void> {
    const fromStat = await this.stat(from);
    if (!fromStat) throw new Error(`FsPort copyTree source missing: ${from}`);
    if (fromStat.isFile) {
      await this.copyFile(from, to);
      return;
    }
    const entries = await this.readdir(from);
    await this.mkdirp(to);
    const prefix = from === "" ? "" : `${from}/`;
    const toPrefix = to === "" ? "" : `${to}/`;
    for (const entry of entries) {
      await this.copyTree(`${prefix}${entry.name}`, `${toPrefix}${entry.name}`);
    }
  }
}
