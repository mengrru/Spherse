export type SettleOutcome = "timeout" | "error";

export function settleWithin(
  promise: Promise<unknown> | undefined | null,
  timeoutMs: number,
  onSettle: (outcome: SettleOutcome, detail?: unknown) => void,
): Promise<void> {
  if (!promise) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        onSettle("timeout");
      } catch { /* ignore */ }
      resolve();
    }, timeoutMs);
    timer.unref();
    promise.then(
      () => {
        settled = true;
        clearTimeout(timer);
        resolve();
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          onSettle("error", err);
        } catch { /* ignore */ }
        resolve();
      },
    );
  });
}
