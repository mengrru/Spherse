import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import matter from "gray-matter";
import { nanoid } from "nanoid";
import { isPathInside } from "../utils/path-safety.js";
import { moveDirAtomic } from "../utils/fs-move.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import { ConflictError, ValidationError } from "../errors.js";

const INVALID_SKILL_NAME_RE = /[/\\:]/;

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

function assertValidSkillName(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("skill name is required");
  if (INVALID_SKILL_NAME_RE.test(trimmed)) {
    throw new ValidationError("skill name must not contain '/', '\\', or ':'");
  }
  if (trimmed.startsWith(".")) {
    throw new ValidationError("skill name must not start with '.'");
  }
}

export async function installSkillZip(
  zipPath: string,
  skillDir: string,
  fileWriteMutex: FileWriteMutex,
  options?: { overwrite?: boolean },
): Promise<string> {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (entries.length === 0) {
    throw new ValidationError("skill package is empty");
  }

  const topLevelNames = new Set<string>();
  for (const entry of entries) {
    const parts = entry.entryName.split("/");
    const top = parts[0];
    if (!top) continue;
    if (!entry.isDirectory && parts.length === 1) {
      throw new ValidationError("skill package must contain a single top-level directory");
    }
    topLevelNames.add(top);
  }
  if (topLevelNames.size !== 1) {
    throw new ValidationError("skill package must contain a single top-level directory");
  }
  const skillFolder = [...topLevelNames][0];
  assertValidSkillName(skillFolder);

  const skillMdEntryName = `${skillFolder}/SKILL.md`;
  const skillMdEntry = entries.find((e) => e.entryName === skillMdEntryName);
  if (!skillMdEntry) {
    throw new ValidationError(`skill package is missing ${skillMdEntryName}`);
  }

  const parsed = matter(skillMdEntry.getData().toString("utf-8"));
  const fmName = parsed.data.name;
  const fmDescription = parsed.data.description;
  if (typeof fmName !== "string" || !fmName.trim() || typeof fmDescription !== "string" || !fmDescription.trim()) {
    throw new ValidationError("skill SKILL.md must have valid name and description frontmatter");
  }
  if (fmName !== skillFolder) {
    throw new ValidationError(
      `skill frontmatter name "${fmName}" does not match folder name "${skillFolder}"`,
    );
  }

  const targetDir = path.join(skillDir, skillFolder);
  const extractRoot = path.join(os.tmpdir(), `skill-install-${nanoid()}`);
  await fs.mkdir(extractRoot, { recursive: true });
  try {
    for (const entry of entries) {
      const resolved = path.resolve(extractRoot, entry.entryName);
      if (!isPathInside(extractRoot, resolved)) {
        throw new ValidationError(`zip entry escapes extraction directory: ${entry.entryName}`);
      }
    }
    zip.extractAllTo(extractRoot, true);

    const extractedSkillDir = path.join(extractRoot, skillFolder);
    if (!(await pathExists(extractedSkillDir))) {
      throw new ValidationError("skill package did not extract the expected directory");
    }

    await fs.mkdir(skillDir, { recursive: true });
    await fileWriteMutex.run(targetDir, async () => {
      const exists = await pathExists(targetDir);
      if (exists && !options?.overwrite) {
        throw new ConflictError(`Skill "${skillFolder}" already exists`);
      }
      if (exists) {
        const backupDir = path.join(os.tmpdir(), `skill-backup-${nanoid()}`);
        await moveDirAtomic(targetDir, backupDir);
        try {
          await moveDirAtomic(extractedSkillDir, targetDir);
        } catch (err) {
          const originalError =
            err instanceof Error ? err : new Error(`skill install failed: ${String(err)}`);
          try {
            await moveDirAtomic(backupDir, targetDir);
          } catch (rollbackErr: unknown) {
            throw new Error(
              `skill "${skillFolder}" install failed and rollback also failed; the previous version is preserved at ${backupDir} (${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)})`,
              { cause: originalError },
            );
          }
          throw originalError;
        }
        await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
      } else {
        await moveDirAtomic(extractedSkillDir, targetDir);
      }
    });
  } finally {
    await fs.rm(extractRoot, { recursive: true, force: true });
  }

  return skillFolder;
}
