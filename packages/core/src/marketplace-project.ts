import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { nanoid } from "nanoid";
import { isPathInside } from "./utils/path-safety.js";
import { moveDirAtomic } from "./utils/fs-move.js";
import { ConflictError, ValidationError } from "./errors.js";

const INVALID_FOLDER_NAME_RE = /[/\\:]/;
const MAX_TARGET_ATTEMPTS = 100;

export interface MarketplaceProjectInstallResult {
  projectRoot: string;
  folderName: string;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

function assertValidFolderName(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("marketplace project folder name is required");
  if (INVALID_FOLDER_NAME_RE.test(trimmed)) {
    throw new ValidationError("marketplace project folder name must not contain '/', '\\', or ':'");
  }
  if (trimmed.startsWith(".")) {
    throw new ValidationError("marketplace project folder name must not start with '.'");
  }
}

async function resolveTargetDir(destDir: string, folderName: string): Promise<string> {
  for (let i = 1; i <= MAX_TARGET_ATTEMPTS; i += 1) {
    const candidate = path.join(destDir, i === 1 ? folderName : `${folderName}-${i}`);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new ConflictError(
    `unable to find a free target name for "${folderName}" under ${destDir}`,
  );
}

function isTargetOccupiedError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOTEMPTY" || code === "EEXIST" || code === "EPERM";
}

export async function installMarketplaceProjectZip(
  zipPath: string,
  destDir: string,
): Promise<MarketplaceProjectInstallResult> {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (entries.length === 0) {
    throw new ValidationError("marketplace project package is empty");
  }

  const topLevelNames = new Set<string>();
  for (const entry of entries) {
    const parts = entry.entryName.split("/");
    const top = parts[0];
    if (!top) continue;
    if (!entry.isDirectory && parts.length === 1) {
      throw new ValidationError("marketplace project package must contain a single top-level directory");
    }
    topLevelNames.add(top);
  }
  if (topLevelNames.size !== 1) {
    throw new ValidationError("marketplace project package must contain a single top-level directory");
  }
  const folderName = [...topLevelNames][0];
  assertValidFolderName(folderName);

  const destStat = await fs.stat(destDir).catch(() => null);
  if (!destStat?.isDirectory()) {
    throw new ValidationError(`destination is not a directory: ${destDir}`);
  }

  const extractRoot = path.join(os.tmpdir(), `marketplace-project-${nanoid()}`);
  await fs.mkdir(extractRoot, { recursive: true });
  try {
    for (const entry of entries) {
      const resolved = path.resolve(extractRoot, entry.entryName);
      if (!isPathInside(extractRoot, resolved)) {
        throw new ValidationError(`zip entry escapes extraction directory: ${entry.entryName}`);
      }
    }
    zip.extractAllTo(extractRoot, true);

    const extractedDir = path.join(extractRoot, folderName);
    if (!(await pathExists(extractedDir))) {
      throw new ValidationError("marketplace project package did not extract the expected directory");
    }

    const targetDir = await resolveTargetDir(destDir, folderName);
    try {
      await moveDirAtomic(extractedDir, targetDir);
    } catch (err) {
      if (isTargetOccupiedError(err)) {
        throw new ConflictError(`destination already exists: ${targetDir}`);
      }
      throw err;
    }
    return { projectRoot: targetDir, folderName };
  } finally {
    await fs.rm(extractRoot, { recursive: true, force: true });
  }
}
