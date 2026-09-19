import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConflictError, ValidationError } from "../errors.js";
import { installMarketplaceProjectZip } from "../marketplace-project.js";

interface ZipEntrySpec {
  entryName: string;
  content?: string;
}

function buildZip(specs: ZipEntrySpec[]): string {
  const zip = new AdmZip();
  for (const spec of specs) {
    if (spec.entryName.endsWith("/")) {
      zip.addFile(spec.entryName, Buffer.alloc(0));
    } else {
      zip.addFile(spec.entryName, Buffer.from(spec.content ?? "", "utf-8"));
    }
  }
  const zipPath = path.join(os.tmpdir(), `marketplace-project-test-${nanoid()}.zip`);
  zip.writeZip(zipPath);
  return zipPath;
}

function projectZip(name: string, files: Record<string, string> = {}): string {
  const specs: ZipEntrySpec[] = [{ entryName: `${name}/` }];
  for (const [rel, content] of Object.entries(files)) {
    specs.push({ entryName: `${name}/${rel}`, content });
  }
  return buildZip(specs);
}

async function makeTempDir(prefix: string): Promise<string> {
  const dir = path.join(os.tmpdir(), `${prefix}-${nanoid()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function listDir(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir);
  return [...entries].sort();
}

describe("installMarketplaceProjectZip", () => {
  let destDir: string;
  const cleanup: string[] = [];

  beforeEach(async () => {
    destDir = await makeTempDir("marketplace-dest");
    cleanup.push(destDir);
  });

  afterEach(async () => {
    for (const dir of cleanup.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("extracts a single top-level directory into destDir", async () => {
    const zipPath = projectZip("my-world", { "readme.md": "hello", "data/scene.json": "{}" });
    cleanup.push(zipPath);

    const result = await installMarketplaceProjectZip(zipPath, destDir);

    expect(result.folderName).toBe("my-world");
    expect(result.projectRoot).toBe(path.join(destDir, "my-world"));
    expect(await listDir(destDir)).toEqual(["my-world"]);
    await expect(fs.readFile(path.join(result.projectRoot, "readme.md"), "utf-8")).resolves.toBe("hello");
    await expect(fs.readFile(path.join(result.projectRoot, "data/scene.json"), "utf-8")).resolves.toBe("{}");
  });

  it("keeps meta.json when present in the zip", async () => {
    const zipPath = projectZip("my-world", { "meta.json": "{}" });
    cleanup.push(zipPath);

    const result = await installMarketplaceProjectZip(zipPath, destDir);

    await expect(fs.readFile(path.join(result.projectRoot, "meta.json"), "utf-8")).resolves.toBe("{}");
  });

  it("renames to {name}-2, {name}-3 when target names are taken", async () => {
    const zipPath = projectZip("my-world");
    cleanup.push(zipPath);
    await fs.mkdir(path.join(destDir, "my-world"));
    await fs.mkdir(path.join(destDir, "my-world-2"));

    const result = await installMarketplaceProjectZip(zipPath, destDir);

    expect(result.projectRoot).toBe(path.join(destDir, "my-world-3"));
    expect(await listDir(destDir)).toEqual(["my-world", "my-world-2", "my-world-3"]);
  });

  it("picks {name}-100 when {name} and -2..-99 are all taken", async () => {
    const zipPath = projectZip("my-world");
    cleanup.push(zipPath);
    await fs.mkdir(path.join(destDir, "my-world"));
    for (let i = 2; i <= 99; i += 1) {
      await fs.mkdir(path.join(destDir, `my-world-${i}`));
    }

    const result = await installMarketplaceProjectZip(zipPath, destDir);

    expect(result.projectRoot).toBe(path.join(destDir, "my-world-100"));
  });

  it("throws ConflictError when rename attempts are exhausted", async () => {
    const zipPath = projectZip("my-world");
    cleanup.push(zipPath);
    await fs.mkdir(path.join(destDir, "my-world"));
    for (let i = 2; i <= 100; i += 1) {
      await fs.mkdir(path.join(destDir, `my-world-${i}`));
    }

    await expect(installMarketplaceProjectZip(zipPath, destDir)).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects a zip with no entries", async () => {
    const zipPath = buildZip([]);
    cleanup.push(zipPath);

    await expect(installMarketplaceProjectZip(zipPath, destDir)).rejects.toBeInstanceOf(ValidationError);
    expect(await listDir(destDir)).toEqual([]);
  });

  it("rejects root-level loose files", async () => {
    const zipPath = buildZip([
      { entryName: "my-world/readme.md", content: "x" },
      { entryName: "loose.txt", content: "x" },
    ]);
    cleanup.push(zipPath);

    await expect(installMarketplaceProjectZip(zipPath, destDir)).rejects.toBeInstanceOf(ValidationError);
    expect(await listDir(destDir)).toEqual([]);
  });

  it("rejects multiple top-level directories", async () => {
    const zipPath = buildZip([
      { entryName: "a/readme.md", content: "x" },
      { entryName: "b/readme.md", content: "x" },
    ]);
    cleanup.push(zipPath);

    await expect(installMarketplaceProjectZip(zipPath, destDir)).rejects.toBeInstanceOf(ValidationError);
    expect(await listDir(destDir)).toEqual([]);
  });

  it.each([".hidden", "a:b"])("rejects invalid top-level folder name %j", async (badName) => {
    const zipPath = buildZip([{ entryName: `${badName}/readme.md`, content: "x" }]);
    cleanup.push(zipPath);

    await expect(installMarketplaceProjectZip(zipPath, destDir)).rejects.toBeInstanceOf(ValidationError);
    expect(await listDir(destDir)).toEqual([]);
  });

  it("rejects zip entries that escape the extraction directory", async () => {
    const zipPath = buildZip([
      { entryName: "my-world/readme.md", content: "x" },
      { entryName: "my-world/../evil.txt", content: "x" },
    ]);
    cleanup.push(zipPath);

    await expect(installMarketplaceProjectZip(zipPath, destDir)).rejects.toBeInstanceOf(ValidationError);
    await expect(pathExists(path.join(destDir, "evil.txt"))).resolves.toBe(false);
    await expect(pathExists(path.join(os.tmpdir(), "evil.txt"))).resolves.toBe(false);
    expect(await listDir(destDir)).toEqual([]);
  });

  it("rejects a destDir that is not a directory", async () => {
    const zipPath = projectZip("my-world");
    cleanup.push(zipPath);
    const filePath = path.join(path.dirname(destDir), `not-a-dir-${nanoid()}.txt`);
    await fs.writeFile(filePath, "x");
    cleanup.push(filePath);

    await expect(installMarketplaceProjectZip(zipPath, filePath)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a non-existent destDir", async () => {
    const zipPath = projectZip("my-world");
    cleanup.push(zipPath);

    await expect(
      installMarketplaceProjectZip(zipPath, path.join(destDir, "missing")),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}
