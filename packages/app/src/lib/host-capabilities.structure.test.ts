import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const appSrc = join(dirname(fileURLToPath(import.meta.url)), "..");

const EXPECTED_CAPABILITY_FIELDS = ["content", "filePicker", "mobileAccess", "openFileExternal"];

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.includes(".test.")) {
      files.push(full);
    }
  }
  return files;
}

describe("HostCapabilities field hygiene", () => {
  it("declares exactly the expected capability fields", () => {
    const source = readFileSync(join(appSrc, "lib/host-bridge.ts"), "utf-8");
    const match = source.match(/export interface HostCapabilities \{([^}]+)\}/);
    expect(match).not.toBeNull();
    const fields = [...match![1].matchAll(/^ {2}([a-zA-Z]+):/gm)].map((m) => m[1]);
    expect([...fields].sort()).toEqual(EXPECTED_CAPABILITY_FIELDS);
  });

  it("every declared capability field has at least one consumer", () => {
    const sources = collectSourceFiles(appSrc)
      .map((file) => readFileSync(file, "utf-8"))
      .join("\n");
    for (const field of EXPECTED_CAPABILITY_FIELDS) {
      expect(sources).toContain("capabilities." + field);
    }
  });
});
