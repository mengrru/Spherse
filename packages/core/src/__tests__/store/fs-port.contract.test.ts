import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import type { FsPort, FsWatchEvent } from "../../store/fs-port.js";
import { NodeFsPort } from "../../store/node-fs-port.js";

export interface FsPortContractSubject {
  port: FsPort;
  close: () => void;
}

export function runFsPortContract(
  subjectName: string,
  createSubject: () => FsPortContractSubject,
): void {
  describe(`FsPort contract: ${subjectName}`, () => {
    let subject: FsPortContractSubject;
    let port: FsPort;

    beforeEach(() => {
      subject = createSubject();
      port = subject.port;
    });

    afterEach(() => {
      subject.close();
    });

    it("writes and reads text and binary round-trip", async () => {
      await port.writeFile("a.txt", "hello");
      expect(await port.readFile("a.txt")).toBe("hello");
      await port.writeBinaryFile("b.bin", new Uint8Array([1, 2, 3]));
      expect(Array.from(await port.readBinaryFile("b.bin"))).toEqual([1, 2, 3]);
    });

    it("writeFileIfMissing does not overwrite existing content", async () => {
      await port.writeFile("keep.txt", "original");
      expect(await port.writeFileIfMissing("keep.txt", "clobbered")).toBe(false);
      expect(await port.readFile("keep.txt")).toBe("original");
      expect(await port.writeFileIfMissing("fresh.txt", "created")).toBe(true);
      expect(await port.readFile("fresh.txt")).toBe("created");
    });

    it("appends content preserving prior bytes", async () => {
      await port.writeFile("log.jsonl", '{"n":1}\n');
      await port.appendFile("log.jsonl", '{"n":2}\n');
      expect(await port.readFile("log.jsonl")).toBe('{"n":1}\n{"n":2}\n');
    });

    it("lists directories and stats entries", async () => {
      await port.mkdirp("nested/deep");
      await port.writeFile("nested/deep/file.txt", "x");
      const entries = await port.readdir("nested");
      expect(entries).toContainEqual({ name: "deep", isDirectory: true });
      const stat = await port.stat("nested/deep/file.txt");
      expect(stat).toMatchObject({ isFile: true, isDirectory: false, size: 1 });
      expect(await port.stat("missing.txt")).toBeNull();
    });

    it("removes files and directories idempotently", async () => {
      await port.writeFile("gone.txt", "x");
      await port.unlink("gone.txt");
      await port.unlink("gone.txt");
      await port.mkdirp("tree/sub");
      await port.writeFile("tree/sub/f.txt", "x");
      await port.rm("tree", { recursive: true });
      await port.rm("tree", { recursive: true });
      expect(await port.stat("tree")).toBeNull();
    });

    it("renames files and directories", async () => {
      await port.writeFile("old.txt", "v");
      await port.rename("old.txt", "new.txt");
      expect(await port.readFile("new.txt")).toBe("v");
      await port.mkdirp("dirA/inner");
      await port.writeFile("dirA/inner/f.txt", "v");
      await port.rename("dirA", "dirB");
      expect(await port.readFile("dirB/inner/f.txt")).toBe("v");
    });

    it("copies files and trees", async () => {
      await port.writeFile("src.txt", "copy me");
      await port.copyFile("src.txt", "dst.txt");
      expect(await port.readFile("dst.txt")).toBe("copy me");
      await port.mkdirp("treeT/sub");
      await port.writeFile("treeT/sub/f.txt", "deep");
      await port.copyTree("treeT", "treeT-copy");
      expect(await port.readFile("treeT-copy/sub/f.txt")).toBe("deep");
    });

    it("classifies watch events as add, change and unlink", async () => {
      const port = subject.port;
      if (!port.capabilities.watch || !port.watch) return;
      const events: FsWatchEvent[] = [];
      const close = port.watch("", (event) => events.push(event));
      await new Promise((resolve) => setTimeout(resolve, 150));
      await port.writeFile("watched.txt", "v1");
      await new Promise((resolve) => setTimeout(resolve, 200));
      await port.writeFile("watched.txt", "v2");
      await new Promise((resolve) => setTimeout(resolve, 200));
      await port.unlink("watched.txt");
      await new Promise((resolve) => setTimeout(resolve, 200));
      close();
      const kinds = events.filter((event) => event.relPath === "watched.txt").map((event) => event.kind);
      expect(kinds).toContain("add");
      expect(kinds).toContain("change");
      expect(kinds).toContain("unlink");
      expect(kinds[kinds.length - 1]).toBe("unlink");
    });

    it("rejects absolute and escaping paths", async () => {
      await expect(port.readFile("/etc/passwd")).rejects.toThrow();
      await expect(port.readFile("../outside.txt")).rejects.toThrow();
      await expect(port.writeFile("sub/../../escape.txt", "x")).rejects.toThrow();
    });
  });
}

describe("NodeFsPort", () => {
  runFsPortContract("NodeFsPort", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-port-contract-"));
    return {
      port: new NodeFsPort(tmpDir),
      close: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
    };
  });
});
