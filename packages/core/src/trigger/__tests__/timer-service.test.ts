import { describe, it, expect, vi } from "vitest";
import { TimerService } from "../timer-service.js";

describe("TimerService", () => {
  it("calls onTick callback", async () => {
    const onTick = vi.fn();
    const service = new TimerService(onTick);

    const realSetTimeout = setTimeout;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));

    service.start();
    const POLL = 10 * 60 * 1000;
    vi.advanceTimersByTime(POLL);

    expect(onTick).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(POLL);
    expect(onTick).toHaveBeenCalledTimes(2);

    service.stop();
    vi.useRealTimers();
    realSetTimeout(() => {}, 0);
  });

  it("stop() clears the timer", async () => {
    const onTick = vi.fn();
    const service = new TimerService(onTick);

    vi.useFakeTimers();
    service.start();
    service.stop();

    vi.advanceTimersByTime(20 * 60 * 1000);
    expect(onTick).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
