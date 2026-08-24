import { compareSemver } from "../../lib/semver";

export type SkillCardState = "install" | "update" | "installed";

export function deriveSkillCardState(
  local: { version?: string } | undefined,
  marketVersion: string,
): SkillCardState {
  if (!local) return "install";
  const cmp = compareSemver(local.version ?? "", marketVersion);
  if (cmp === null || cmp >= 0) return "installed";
  return "update";
}
