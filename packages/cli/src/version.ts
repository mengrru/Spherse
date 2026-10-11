import { readFileSync } from "node:fs";

export const MIN_NODE_VERSION = "22.19.0";

export function checkNodeVersion(current: string): string | null {
  const parts = current.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null;
  const [major, minor, patch] = parts;
  const [minMajor, minMinor, minPatch] = MIN_NODE_VERSION.split(".").map((part) => Number.parseInt(part, 10));
  const below =
    major < minMajor ||
    (major === minMajor && (minor < minMinor || (minor === minMinor && patch < minPatch)));
  if (!below) return null;
  return `Spherse requires Node.js >= ${MIN_NODE_VERSION}, but you are running ${current}. Please upgrade Node.js first (on Termux: pkg upgrade nodejs, or install a newer Node from your package manager).`;
}

export function readCliVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
    version: string;
  };
  return pkg.version;
}
