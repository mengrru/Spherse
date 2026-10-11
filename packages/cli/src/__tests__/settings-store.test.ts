import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ensureServerToken, generateAccessToken, readServerToken } from "../settings-store.js";

const base = mkdtempSync(join(tmpdir(), "spherse-cli-settings-"));
afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("generateAccessToken", () => {
  it("produces 64-char hex", () => {
    const token = generateAccessToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(generateAccessToken()).not.toBe(token);
  });
});

describe("readServerToken", () => {
  it("returns null when the file does not exist", () => {
    expect(readServerToken(join(base, "missing.json"))).toBeNull();
  });

  it("returns null for corrupted or invalid payloads", () => {
    const corrupt = join(base, "corrupt.json");
    writeFileSync(corrupt, "{ not json", "utf-8");
    expect(readServerToken(corrupt)).toBeNull();
    const empty = join(base, "empty-token.json");
    writeFileSync(empty, JSON.stringify({ serverToken: "" }), "utf-8");
    expect(readServerToken(empty)).toBeNull();
  });

  it("returns the stored token", () => {
    const path = join(base, "ok.json");
    writeFileSync(path, JSON.stringify({ serverToken: "abc123" }), "utf-8");
    expect(readServerToken(path)).toBe("abc123");
  });
});

describe("ensureServerToken", () => {
  it("generates and persists a token on first call, then reuses it", () => {
    const path = join(base, "home1", "settings.json");
    const first = ensureServerToken(path);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(readServerToken(path)).toBe(first);
    expect(ensureServerToken(path)).toBe(first);
  });

  it("overwrites a corrupted file with a fresh token", () => {
    const dir = join(base, "home2");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "settings.json");
    writeFileSync(path, "]]] broken", "utf-8");
    const token = ensureServerToken(path);
    expect(readServerToken(path)).toBe(token);
  });

  it("leaves no tmp files behind", () => {
    const dir = join(base, "home3");
    const path = join(dir, "settings.json");
    ensureServerToken(path);
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(existsSync(path)).toBe(true);
  });
});
