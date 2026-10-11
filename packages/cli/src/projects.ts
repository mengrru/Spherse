import { isPathInside } from "@spherse/core";
import { mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const DEFAULT_PROJECT_NAME = "default";

export interface ScannedProject {
  name: string;
  root: string;
}

export class ProjectDirError extends Error {}

export function scanProjects(projectsDir: string): ScannedProject[] {
  let entries;
  try {
    entries = readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return names.map((name) => {
    const root = resolve(join(projectsDir, name));
    if (!isPathInside(projectsDir, root)) {
      throw new ProjectDirError(`project root escaped projects dir: ${root}`);
    }
    return { name, root };
  });
}

export function ensureDefaultProject(projectsDir: string): ScannedProject | null {
  if (scanProjects(projectsDir).length > 0) return null;
  return createProjectDir(projectsDir, DEFAULT_PROJECT_NAME);
}

const FORBIDDEN_CHARS = /[\\/:*?"<>|]/;

function hasControlChars(name: string): boolean {
  return Array.from(name).some((ch) => ch.charCodeAt(0) < 0x20);
}

export function validateProjectName(name: string, projectsDir: string): void {
  if (name === "") throw new ProjectDirError("project name must not be empty");
  if (name.startsWith(".")) throw new ProjectDirError(`project name must not start with ".": ${name}`);
  if (FORBIDDEN_CHARS.test(name) || hasControlChars(name)) {
    throw new ProjectDirError(`project name must not contain path separators or reserved characters: ${name}`);
  }
  const existing = listExistingNames(projectsDir);
  const collision = existing.find((entry) => entry.toLowerCase() === name.toLowerCase());
  if (collision !== undefined) {
    throw new ProjectDirError(`project "${collision}" already exists`);
  }
}

export function createProjectDir(projectsDir: string, name: string): ScannedProject {
  const root = resolve(join(projectsDir, name));
  if (!isPathInside(projectsDir, root)) {
    throw new ProjectDirError(`project root escaped projects dir: ${root}`);
  }
  mkdirSync(root, { recursive: true });
  return { name, root };
}

function listExistingNames(projectsDir: string): string[] {
  try {
    return readdirSync(projectsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
