export interface FsEntry {
  name: string;
  isDirectory: boolean;
}

export interface FsStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtime: number;
  id?: string;
}

export type FsWatchEventKind = "add" | "change" | "unlink";

export interface FsWatchEvent {
  relPath: string;
  kind: FsWatchEventKind;
}

export interface FsPortCapabilities {
  atomicRename: boolean;
  watch: boolean;
}

export interface FsPort {
  capabilities: FsPortCapabilities;
  readFile(relPath: string): Promise<string>;
  readBinaryFile(relPath: string): Promise<Uint8Array>;
  writeFile(relPath: string, content: string): Promise<void>;
  writeBinaryFile(relPath: string, data: Uint8Array): Promise<void>;
  writeFileIfMissing(relPath: string, content: string): Promise<boolean>;
  appendFile(relPath: string, content: string): Promise<void>;
  mkdirp(relPath: string): Promise<void>;
  readdir(relPath: string): Promise<FsEntry[]>;
  stat(relPath: string): Promise<FsStat | null>;
  unlink(relPath: string): Promise<void>;
  rm(relPath: string, options: { recursive: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  copyTree(from: string, to: string): Promise<void>;
  watch?(relPath: string, onChange: (event: FsWatchEvent) => void): () => void;
}
