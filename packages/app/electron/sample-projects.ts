import { app } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import type { SampleManifestEntry } from "@shared/electron-api.js";

export function getSampleProjectsRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "sample-projects");
  }
  const root = path.resolve(app.getAppPath(), "..", "presets", "sample-projects");
  console.log("[sample-projects] dev root resolved to:", root);
  return root;
}

function isValidSampleEntry(entry: unknown): entry is SampleManifestEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  if (typeof e.id !== "string" || e.id.length === 0) return false;
  if (typeof e.displayName !== "string" || e.displayName.length === 0) return false;
  if (typeof e.dirName !== "string" || e.dirName.length === 0) return false;
  if (e.dirName === "." || e.dirName === "..") return false;
  if (e.displayName === "." || e.displayName === "..") return false;
  if (path.basename(e.dirName) !== e.dirName) return false;
  if (path.basename(e.displayName) !== e.displayName) return false;
  return true;
}

export async function readSampleManifest(): Promise<SampleManifestEntry[]> {
  const manifestPath = path.join(getSampleProjectsRoot(), "manifest.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(isValidSampleEntry);
    if (valid.length !== parsed.length) {
      console.warn("[sample-projects] filtered out", parsed.length - valid.length, "malformed manifest entries");
    }
    return valid;
  } catch (err) {
    console.error("[sample-projects] failed to read manifest:", err);
    return [];
  }
}

export function resolveSampleSrcDir(entry: SampleManifestEntry): string {
  return path.join(getSampleProjectsRoot(), entry.dirName);
}
