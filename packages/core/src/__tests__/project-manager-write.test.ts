import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProjectStore } from "../store/project.js";
import { ProjectManager } from "../project-manager.js";
import { FileWriteMutex } from "../utils/file-write-mutex.js";
import { createSilentLogger } from "../logger.js";

describe("ProjectManager write facade policy regression", () => {
  let tmpDir: string;
  let pm: ProjectManager;
  let store: ProjectStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-pm-write-"));
    store = new ProjectStore(tmpDir, createSilentLogger());
    await store.create("Test");
    pm = new ProjectManager(store, createSilentLogger(), new FileWriteMutex());
  });

  afterEach(async () => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writeBinaryFile allows the attachments directory (C1 regression)", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await pm.writeBinaryFile(".spherse/attachments/photo.png", bytes);
    expect(fs.existsSync(path.join(tmpDir, ".spherse/attachments/photo.png"))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, ".spherse/attachments/photo.png"))).toEqual(bytes);
  });

  it("writeFile allows user files and the project theme", async () => {
    await pm.writeFile("docs/chapter.md", "hello");
    await pm.writeFile(".spherse/theme.css", "body{}");
    expect(fs.readFileSync(path.join(tmpDir, "docs/chapter.md"), "utf-8")).toBe("hello");
  });

  it("writeFile still denies engine-internal paths", async () => {
    await expect(pm.writeFile(".spherse/agents/a/profile.md", "x")).rejects.toThrow(
      /not permitted/,
    );
    await expect(pm.writeFile(".spherse/project.yaml", "x")).rejects.toThrow(/not permitted/);
  });

  it("writeBinaryFile still denies outside the project", async () => {
    await expect(pm.writeBinaryFile("../escape.png", Buffer.from([1]))).rejects.toThrow();
  });
});
