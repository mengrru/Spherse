import { useBusStore } from "../stores/bus-store";
import { useReplicaStore } from "../features/chat/replica-store";
import { createResumeProbeScheduler } from "./resume-probe-scheduler";

const RESUME_PROBE_THRESHOLD_MS = 30_000;
const RESUME_PROBE_DEBOUNCE_MS = 10_000;

/**
 * Replacement for the old resume-reload: when the host page resumes from
 * background suspension (hidden >= threshold) or bfcache restore, actively
 * probe the bus/chat sockets for liveness instead of reloading the page.
 * Dead links are closed by the probe, after which the existing reconnect +
 * reconcile machinery (and `resumedAt` subscribers) resyncs all data —
 * keeping scroll position, route and UI state intact.
 *
 * Lives in the shared app package (DOM events work under jsdom) so the
 * binding is unit-testable; only the web shell mounts it.
 */
export function setupWebResumeProbe(): () => void {
  const scheduler = createResumeProbeScheduler({
    hiddenThresholdMs: RESUME_PROBE_THRESHOLD_MS,
    debounceMs: RESUME_PROBE_DEBOUNCE_MS,
  });

  const probe = () => {
    useBusStore.getState().resumeProbe();
    useReplicaStore.getState().resumeProbeAll();
  };

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      scheduler.onVisibilityChange("hidden", Date.now());
    } else if (
      document.visibilityState === "visible" &&
      scheduler.onVisibilityChange("visible", Date.now())
    ) {
      probe();
    }
  };

  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted && scheduler.onPageShowPersisted(Date.now())) {
      probe();
    }
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", onPageShow);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pageshow", onPageShow);
  };
}
