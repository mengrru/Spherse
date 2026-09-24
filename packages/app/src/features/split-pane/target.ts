import { isTabTarget, normalizeTabTarget, type TabTarget } from "../../lib/tab-target";

export type SplitTarget = TabTarget;

const SUPPORTED_KINDS: ReadonlySet<SplitTarget["kind"]> = new Set(["file"]);

export function isSplitTarget(value: unknown): value is SplitTarget {
  return isTabTarget(value) && SUPPORTED_KINDS.has(value.kind);
}

export function toSplitTarget(value: unknown): SplitTarget | null {
  return isSplitTarget(value) ? normalizeTabTarget(value) : null;
}
