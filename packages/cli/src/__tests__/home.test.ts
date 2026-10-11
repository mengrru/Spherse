import { mkdtempSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { homePaths, initHome, resolveHome } from "../home.js";

const base = mkdtempSync(join(tmpdir(), "spherse-cli-home-"));
afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("resolveHome", () => {
  it("prefers the flag over env and default", () => {
    const flagDir = join(base, "from-flag");
    const prev = process.env.SPHERSE_HOME;
    process.env.SPHERSE_HOME = join(base, "from-env");
    try {
      expect(resolveHome(flagDir)).toBe(flagDir);
      expect(resolveHome()).toBe(join(base, "from-env"));
    } finally {
      if (prev === undefined) delete process.env.SPHERSE_HOME;
      else process.env.SPHERSE_HOME = prev;
    }
  });

  it("falls back to ~/.spherse when flag and env are absent", () => {
    const prev = process.env.SPHERSE_HOME;
    delete process.env.SPHERSE_HOME;
    try {
      expect(resolveHome()).toBe(join(homedir(), ".spherse"));
    } finally {
      if (prev !== undefined) process.env.SPHERSE_HOME = prev;
    }
  });

  it("resolves relative paths against cwd", () => {
    const prev = process.env.SPHERSE_HOME;
    delete process.env.SPHERSE_HOME;
    try {
      expect(resolveHome("relative/dir").startsWith("/")).toBe(true);
    } finally {
      if (prev !== undefined) process.env.SPHERSE_HOME = prev;
    }
  });
});

describe("homePaths", () => {
  it("lays out files under the home dir", () => {
    const paths = homePaths(join(base, "h1"));
    expect(paths.settingsPath).toBe(join(paths.home, "settings.json"));
    expect(paths.modelSettingsPath).toBe(join(paths.home, "model-settings.json"));
    expect(paths.projectsDir).toBe(join(paths.home, "projects"));
    expect(paths.lockfilePath).toBe(join(paths.home, "server.lock"));
  });
});

describe("initHome", () => {
  it("creates the projects dir recursively", () => {
    const paths = homePaths(join(base, "h2", "nested"));
    initHome(paths);
    expect(statSync(paths.projectsDir).isDirectory()).toBe(true);
  });
});
