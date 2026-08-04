import { describe, it, expect } from "vitest";
import {
  computePerceivedTime,
  formatPerceivedTime,
  buildTimePrefix,
  isActiveTimePerception,
} from "../../context/time-perception.js";
import type { TimePerceptionConfig } from "../../types.js";

const EPOCH = Date.UTC(2026, 0, 1);
const START = Date.UTC(2050, 0, 1);

const baseConfig: TimePerceptionConfig = {
  enabled: true,
  epochMs: EPOCH,
  startMs: START,
  flowRate: 1,
};

describe("computePerceivedTime", () => {
  it("returns startMs when realMs equals epochMs", () => {
    expect(computePerceivedTime(EPOCH, baseConfig)).toBe(START);
  });

  it("applies flowRate=1 as 1:1 mapping", () => {
    const oneHourLater = EPOCH + 3600_000;
    expect(computePerceivedTime(oneHourLater, baseConfig)).toBe(START + 3600_000);
  });

  it("applies flowRate=60 as 60x speedup", () => {
    const config = { ...baseConfig, flowRate: 60 };
    const oneMinuteLater = EPOCH + 60_000;
    expect(computePerceivedTime(oneMinuteLater, config)).toBe(START + 3600_000);
  });

  it("applies flowRate=0 as frozen time", () => {
    const config = { ...baseConfig, flowRate: 0 };
    expect(computePerceivedTime(EPOCH + 999_999, config)).toBe(START);
  });

  it("handles negative elapsed (realMs before epoch)", () => {
    const config = { ...baseConfig, flowRate: 2 };
    const oneHourBefore = EPOCH - 3600_000;
    expect(computePerceivedTime(oneHourBefore, config)).toBe(START - 7200_000);
  });

  it("is deterministic: same inputs always produce same output", () => {
    const real = EPOCH + 123456;
    expect(computePerceivedTime(real, baseConfig)).toBe(
      computePerceivedTime(real, baseConfig),
    );
  });
});

describe("formatPerceivedTime", () => {
  it("formats UTC time with UTC timeZone", () => {
    const ms = Date.UTC(2050, 5, 15, 14, 30);
    const result = formatPerceivedTime(ms, "UTC");
    expect(result).toContain("Jun");
    expect(result).toContain("15");
    expect(result).toContain("2050");
    expect(result).toContain("14:30");
  });

  it("applies timeZone offset", () => {
    const ms = Date.UTC(2050, 5, 15, 14, 30);
    const utcResult = formatPerceivedTime(ms, "UTC");
    const shanghaiResult = formatPerceivedTime(ms, "Asia/Shanghai");
    expect(shanghaiResult).not.toBe(utcResult);
    expect(shanghaiResult).toContain("22:30");
  });
});

describe("buildTimePrefix", () => {
  it("produces XML-wrapped time string", () => {
    const real = EPOCH;
    const prefix = buildTimePrefix(real, baseConfig);
    expect(prefix).toMatch(/^<time>.+<\/time>$/);
    expect(prefix).toContain("2050");
  });

  it("reflects flowRate in the formatted time", () => {
    const config = { ...baseConfig, flowRate: 60, timeZone: "UTC" };
    const real = EPOCH + 60_000;
    const prefix = buildTimePrefix(real, config);
    expect(prefix).toContain("01:00"); // 60x of 1 minute
  });
});

describe("isActiveTimePerception", () => {
  it("returns false for undefined", () => {
    expect(isActiveTimePerception(undefined)).toBe(false);
  });

  it("returns false when disabled", () => {
    expect(isActiveTimePerception({ ...baseConfig, enabled: false })).toBe(false);
  });

  it("returns false when flowRate is 0", () => {
    expect(isActiveTimePerception({ ...baseConfig, flowRate: 0 })).toBe(false);
  });

  it("returns false when flowRate is negative", () => {
    expect(isActiveTimePerception({ ...baseConfig, flowRate: -1 })).toBe(false);
  });

  it("returns true when enabled and flowRate > 0", () => {
    expect(isActiveTimePerception(baseConfig)).toBe(true);
  });
});
