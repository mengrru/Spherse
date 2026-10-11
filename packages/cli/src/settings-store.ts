import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function generateAccessToken(): string {
  return randomBytes(32).toString("hex");
}

interface SettingsFile {
  serverToken?: unknown;
}

export function readServerToken(settingsPath: string): string | null {
  if (!existsSync(settingsPath)) return null;
  let parsed: SettingsFile;
  try {
    parsed = JSON.parse(readFileSync(settingsPath, "utf-8")) as SettingsFile;
  } catch {
    return null;
  }
  const token = parsed.serverToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

export function ensureServerToken(settingsPath: string): string {
  const existing = readServerToken(settingsPath);
  if (existing) return existing;
  const token = generateAccessToken();
  writeSettingsFile(settingsPath, { serverToken: token });
  return token;
}

function writeSettingsFile(settingsPath: string, data: SettingsFile): void {
  mkdirSync(dirname(settingsPath), { recursive: true });
  const tmp = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
  renameSync(tmp, settingsPath);
}
