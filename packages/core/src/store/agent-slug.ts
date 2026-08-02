import { ValidationError } from "../errors.js";

const MAX_SLUG_BASE_LENGTH = 40;
const FALLBACK_SLUG_BASE = "agent";

/**
 * Normalize an arbitrary agent name (or caller-supplied slug hint) into a filesystem-safe
 * directory prefix. CJK characters are preserved so Chinese agent names stay readable on disk.
 */
export function deriveAgentSlugBase(source: string): string {
  const normalized = source
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_BASE_LENGTH)
    .replace(/^-+|-+$/g, "");
  return normalized || FALLBACK_SLUG_BASE;
}

/**
 * Build a collision-free agent directory name from a slug base and the agent id.
 * Widens the id suffix before falling back to a numeric discriminator.
 */
export function buildAgentDirName(
  slugBase: string,
  agentId: string,
  taken: ReadonlySet<string>,
): string {
  const base = deriveAgentSlugBase(slugBase);
  const compactId = agentId.replace(/-/g, "");
  for (const length of [6, 8, 10, 12]) {
    const candidate = `${base}-${compactId.slice(0, length)}`;
    if (!taken.has(candidate)) return candidate;
  }
  const prefix = `${base}-${compactId.slice(0, 12)}`;
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${prefix}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new ValidationError("unable to allocate a unique agent directory name");
}
