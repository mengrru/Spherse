import path from "node:path";
import { resolveProjectPath } from "../../utils/path-safety.js";

const DATA_EXTENSION = ".data.json";
const CARD_DATA_PREFIX = ".spherse/data/cards/";

export function resolveDataFile(projectRoot: string, file: string): string {
  if (typeof file !== "string" || !file) throw new Error("file must be a non-empty string");
  const normalized = file.replace(/\\/g, "/");
  if (!normalized.endsWith(DATA_EXTENSION)) {
    throw new Error(`data file must end with ${DATA_EXTENSION}: ${file}`);
  }
  if (normalized.startsWith(".spherse/") && !normalized.startsWith(CARD_DATA_PREFIX)) {
    throw new Error("data file must not live inside .spherse/");
  }
  const resolved = resolveProjectPath(path.resolve(projectRoot), normalized);
  const relative = path.relative(path.resolve(projectRoot), resolved).replace(/\\/g, "/");
  if (relative.startsWith(".spherse/") && !relative.startsWith(CARD_DATA_PREFIX)) {
    throw new Error("data file must not live inside .spherse/");
  }
  return resolved;
}

export function toPosixRelative(projectRoot: string, absolutePath: string): string {
  return path.relative(path.resolve(projectRoot), absolutePath).replace(/\\/g, "/");
}

export function isReservedKey(key: string): boolean {
  return key.startsWith("$");
}
