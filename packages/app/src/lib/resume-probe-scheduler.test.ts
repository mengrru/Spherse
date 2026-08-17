import { describe, expect, it } from "vitest";
import { createResumeProbeScheduler } from "./resume-probe-scheduler";

const OPTIONS = { hiddenThresholdMs: 30_000, debounceMs: 10_000 };

describe("createResumeProbeScheduler", () => {
  it("does not probe when the page was hidden shorter than the threshold", () => {
    const scheduler = createResumeProbeScheduler(OPTIONS);
    expect(scheduler.onVisibilityChange("hidden", 0)).toBe(false);
    expect(scheduler.onVisibilityChange("visible", 29_999)).toBe(false);
  });

  it("probes when the page was hidden at least the threshold", () => {
    const scheduler = createResumeProbeScheduler(OPTIONS);
    scheduler.onVisibilityChange("hidden", 0);
    expect(scheduler.onVisibilityChange("visible", 30_000)).toBe(true);
  });

  it("ignores visible events without a preceding hidden", () => {
    const scheduler = createResumeProbeScheduler(OPTIONS);
    expect(scheduler.onVisibilityChange("visible", 50_000)).toBe(false);
  });

  it("debounces probes closer than debounceMs (first one wins)", () => {
    const scheduler = createResumeProbeScheduler(OPTIONS);
    scheduler.onVisibilityChange("hidden", 0);
    expect(scheduler.onVisibilityChange("visible", 30_000)).toBe(true);
    // second resume right after: collapsed
    scheduler.onVisibilityChange("hidden", 30_100);
    expect(scheduler.onVisibilityChange("visible", 35_000)).toBe(false);
    // after the debounce window: probes again
    scheduler.onVisibilityChange("hidden", 45_000);
    expect(scheduler.onVisibilityChange("visible", 80_000)).toBe(true);
  });

  it("probes on bfcache restore and debounces against visibility probes", () => {
    const scheduler = createResumeProbeScheduler(OPTIONS);
    scheduler.onVisibilityChange("hidden", 0);
    expect(scheduler.onVisibilityChange("visible", 30_000)).toBe(true);
    expect(scheduler.onPageShowPersisted(31_000)).toBe(false);
    expect(scheduler.onPageShowPersisted(50_000)).toBe(true);
  });

  it("hidden while already hidden keeps the earliest hidden timestamp", () => {
    const scheduler = createResumeProbeScheduler(OPTIONS);
    scheduler.onVisibilityChange("hidden", 0);
    scheduler.onVisibilityChange("hidden", 100_000);
    // still compares against the first hidden: 100_000 - 0 >= threshold → probe
    expect(scheduler.onVisibilityChange("visible", 100_000)).toBe(true);
  });
});
