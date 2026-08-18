/**
 * Pure scheduling logic for "resume probes" (host page resumed from
 * background suspension / bfcache). Kept free of DOM access so it can be unit
 * tested; the web shell (`packages/web/src/resume-probe.ts`) binds the actual
 * DOM events and delegates decisions here.
 */

export interface ResumeProbeScheduler {
  /** Call on every `visibilitychange`. Returns true when a probe is due. */
  onVisibilityChange(visibility: "visible" | "hidden", now: number): boolean;
  /** Call on `pageshow` with `event.persisted === true` (bfcache restore). Returns true when a probe is due. */
  onPageShowPersisted(now: number): boolean;
}

export interface CreateResumeProbeSchedulerOptions {
  /** Page must have been hidden at least this long before a resume triggers a probe. */
  hiddenThresholdMs: number;
  /** Two probes closer than this are collapsed (the first one already ran). */
  debounceMs: number;
}

export function createResumeProbeScheduler(
  options: CreateResumeProbeSchedulerOptions,
): ResumeProbeScheduler {
  let hiddenAt: number | null = null;
  let lastProbeAt = -Infinity;

  function shouldProbe(now: number): boolean {
    if (now - lastProbeAt < options.debounceMs) return false;
    lastProbeAt = now;
    return true;
  }

  return {
    onVisibilityChange(visibility, now) {
      if (visibility === "hidden") {
        hiddenAt ??= now;
        return false;
      }
      if (hiddenAt === null) return false;
      const hiddenFor = now - hiddenAt;
      hiddenAt = null;
      if (hiddenFor < options.hiddenThresholdMs) return false;
      return shouldProbe(now);
    },
    onPageShowPersisted(now) {
      return shouldProbe(now);
    },
  };
}
