import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, isRateLimitWhitelisted, RATE_LIMIT_WHITELIST, resetRateLimit } from "./rate-limit";

const MAX_CALLS_PER_MINUTE = 30;

describe("rate-limit", () => {
  beforeEach(() => resetRateLimit());
  afterEach(() => resetRateLimit());

  it("allows up to MAX_CALLS_PER_MINUTE non-whitelisted calls then blocks", () => {
    for (let i = 0; i < MAX_CALLS_PER_MINUTE; i++) {
      expect(checkRateLimit("openFile")).toBe(true);
    }
    expect(checkRateLimit("openFile")).toBe(false);
  });

  it("includes data.get in the whitelist", () => {
    expect(RATE_LIMIT_WHITELIST.has("data.get")).toBe(true);
    expect(isRateLimitWhitelisted("data.get")).toBe(true);
  });

  it("includes data.keys in the whitelist", () => {
    expect(RATE_LIMIT_WHITELIST.has("data.keys")).toBe(true);
    expect(isRateLimitWhitelisted("data.keys")).toBe(true);
  });

  it("includes data.entries in the whitelist", () => {
    expect(RATE_LIMIT_WHITELIST.has("data.entries")).toBe(true);
    expect(isRateLimitWhitelisted("data.entries")).toBe(true);
  });

  it("never rate-limits whitelisted actions regardless of call count", () => {
    for (let i = 0; i < MAX_CALLS_PER_MINUTE * 5; i++) {
      expect(checkRateLimit("data.get")).toBe(true);
    }
  });

  it("whitelisted calls do not consume the shared quota", () => {
    for (let i = 0; i < MAX_CALLS_PER_MINUTE * 3; i++) {
      expect(checkRateLimit("data.get")).toBe(true);
    }
    for (let i = 0; i < MAX_CALLS_PER_MINUTE; i++) {
      expect(checkRateLimit("openFile")).toBe(true);
    }
    expect(checkRateLimit("openFile")).toBe(false);
  });

  it("does not whitelist unknown or non-read actions", () => {
    expect(isRateLimitWhitelisted("data.set")).toBe(false);
    expect(isRateLimitWhitelisted("data.delete")).toBe(false);
    expect(isRateLimitWhitelisted("unknownAction")).toBe(false);
  });

  it("resetRateLimit clears the consumed quota", () => {
    for (let i = 0; i < MAX_CALLS_PER_MINUTE; i++) {
      expect(checkRateLimit("openFile")).toBe(true);
    }
    expect(checkRateLimit("openFile")).toBe(false);
    resetRateLimit();
    expect(checkRateLimit("openFile")).toBe(true);
  });

  it("evicts stale timestamps after the window expires even when interleaved with whitelisted calls", () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < MAX_CALLS_PER_MINUTE; i++) {
        expect(checkRateLimit("openFile")).toBe(true);
      }
      expect(checkRateLimit("openFile")).toBe(false);
      for (let i = 0; i < 5; i++) {
        expect(checkRateLimit("data.get")).toBe(true);
      }
      vi.advanceTimersByTime(61_000);
      expect(checkRateLimit("openFile")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
