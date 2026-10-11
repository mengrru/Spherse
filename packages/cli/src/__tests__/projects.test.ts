import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT_NAME,
  ProjectDirError,
  ensureDefaultProject,
  createProjectDir,
  scanProjects,
  validateProjectName,
} from "../projects.js";

const base = mkdtempSync(join(tmpdir(), "spherse-cli-projects-"));
afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

function projectsDir(name: string): string {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("scanProjects", () => {
  it("returns [] when the dir does not exist", () => {
    expect(scanProjects(join(base, "nope"))).toEqual([]);
  });

  it("returns only non-dotfile directories sorted by name", () => {
    const dir = projectsDir("scan1");
    mkdirSync(join(dir, "beta"));
    mkdirSync(join(dir, "alpha"));
    mkdirSync(join(dir, ".hidden"));
    writeFileSync(join(dir, "plain-file"), "x", "utf-8");
    const scanned = scanProjects(dir);
    expect(scanned.map((p) => p.name)).toEqual(["alpha", "beta"]);
    expect(scanned[0].root).toBe(join(dir, "alpha"));
  });

  it("skips symlinks even when they point at directories", () => {
    const dir = projectsDir("scan2");
    const target = projectsDir("scan2-outside");
    mkdirSync(join(dir, "real"));
    symlinkSync(target, join(dir, "link"));
    expect(scanProjects(dir).map((p) => p.name)).toEqual(["real"]);
  });
});

describe("ensureDefaultProject", () => {
  it("creates the default project when projects dir is empty", () => {
    const dir = projectsDir("default1");
    const created = ensureDefaultProject(dir);
    expect(created?.name).toBe(DEFAULT_PROJECT_NAME);
    expect(created?.root).toBe(join(dir, DEFAULT_PROJECT_NAME));
  });

  it("is a no-op once any project exists", () => {
    const dir = projectsDir("default2");
    mkdirSync(join(dir, "existing"));
    expect(ensureDefaultProject(dir)).toBeNull();
    expect(scanProjects(dir).map((p) => p.name)).toEqual(["existing"]);
  });

  it("is idempotent right after creating the default project", () => {
    const dir = projectsDir("default3");
    ensureDefaultProject(dir);
    expect(ensureDefaultProject(dir)).toBeNull();
  });
});

describe("validateProjectName", () => {
  it("rejects empty, dotfile and separator-containing names", () => {
    const dir = projectsDir("validate");
    expect(() => validateProjectName("", dir)).toThrow(ProjectDirError);
    expect(() => validateProjectName(".secret", dir)).toThrow(ProjectDirError);
    expect(() => validateProjectName("a/b", dir)).toThrow(ProjectDirError);
    expect(() => validateProjectName("a\\b", dir)).toThrow(ProjectDirError);
    expect(() => validateProjectName('a:"*?<>|', dir)).toThrow(ProjectDirError);
  });

  it("accepts plain and non-ASCII names", () => {
    const dir = projectsDir("validate-ok");
    expect(() => validateProjectName("my-world", dir)).not.toThrow();
    expect(() => validateProjectName("我的世界", dir)).not.toThrow();
  });

  it("rejects case-insensitive collisions", () => {
    const dir = projectsDir("validate-case");
    mkdirSync(join(dir, "World"));
    expect(() => validateProjectName("world", dir)).toThrow(/already exists/);
    expect(() => validateProjectName("WORLD", dir)).toThrow(/already exists/);
    expect(() => validateProjectName("other", dir)).not.toThrow();
  });
});

describe("createProjectDir", () => {
  it("creates the directory and returns its resolved root", () => {
    const dir = projectsDir("create");
    const project = createProjectDir(dir, "fresh");
    expect(project).toEqual({ name: "fresh", root: join(dir, "fresh") });
    expect(scanProjects(dir).map((p) => p.name)).toEqual(["fresh"]);
  });
});
