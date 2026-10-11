import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { checkNodeVersion, runCli } from "../main.js";

const base = mkdtempSync(join(tmpdir(), "spherse-cli-main-"));
afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("checkNodeVersion", () => {
  it("accepts versions at or above the minimum", () => {
    expect(checkNodeVersion("22.19.0")).toBeNull();
    expect(checkNodeVersion("22.19.1")).toBeNull();
    expect(checkNodeVersion("23.0.0")).toBeNull();
    expect(checkNodeVersion("24.1.0")).toBeNull();
  });

  it("rejects versions below the minimum", () => {
    expect(checkNodeVersion("22.18.9")).toMatch(/22\.19\.0/);
    expect(checkNodeVersion("21.0.0")).toMatch(/22\.19\.0/);
    expect(checkNodeVersion("20.11.0")).toMatch(/Termux/);
  });

  it("ignores non-numeric versions instead of crashing", () => {
    expect(checkNodeVersion("weird")).toBeNull();
  });
});

describe("runCli", () => {
  it("prints help and exits 0", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await runCli([])).toBe(0);
      expect(await runCli(["--help"])).toBe(0);
      expect(log.mock.calls.flat().join("\n")).toContain("spherse server");
    } finally {
      log.mockRestore();
    }
  });

  it("prints the package version", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await runCli(["--version"])).toBe(0);
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+/));
    } finally {
      log.mockRestore();
    }
  });

  it("reports arg errors on stderr and exits 1", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await runCli(["frobnicate"])).toBe(1);
      expect(err.mock.calls.flat().join("\n")).toContain("unknown command");
    } finally {
      err.mockRestore();
    }
  });

  it("creates a project via the new command", async () => {
    const home = join(base, "new-home");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await runCli(["new", "world", "--home", home])).toBe(0);
      expect(readdirSync(join(home, "projects"))).toEqual(["world"]);
      expect(log.mock.calls.flat().join("\n")).toContain("spherse server");
    } finally {
      log.mockRestore();
    }
  });

  it("rejects duplicate project names case-insensitively", async () => {
    const home = join(base, "dup-home");
    await runCli(["new", "World", "--home", home]);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await runCli(["new", "world", "--home", home])).toBe(1);
      expect(err.mock.calls.flat().join("\n")).toContain("already exists");
    } finally {
      err.mockRestore();
    }
  });

  it("refuses the server command in this build", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await runCli(["server"])).toBe(1);
      expect(err.mock.calls.flat().join("\n")).toContain("not available");
    } finally {
      err.mockRestore();
    }
  });
});
