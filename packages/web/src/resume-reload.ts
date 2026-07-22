const RESUME_RELOAD_THRESHOLD_MS = 30_000;

export function setupWebResumeReload(): () => void {
  let hiddenAt: number | null = null;
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
    } else if (document.visibilityState === "visible" && hiddenAt !== null) {
      if (Date.now() - hiddenAt >= RESUME_RELOAD_THRESHOLD_MS) {
        window.location.reload();
        return;
      }
      hiddenAt = null;
    }
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      window.location.reload();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", onPageShow);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pageshow", onPageShow);
  };
}
