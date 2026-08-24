import { compareVersions, validateStrict } from "compare-versions";

export function isValidSemver(version: string): boolean {
  return validateStrict(version);
}

export function compareSemver(a: string, b: string): number | null {
  if (!validateStrict(a) || !validateStrict(b)) return null;
  return compareVersions(a, b);
}
