import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEntry } from "../model/entry";
import { useChatSessionStore } from "../runtime/session-store";
import { computeAnchorAdjustment, isNearBottom, useChatScroll } from "./useChatScroll";

describe("isNearBottom (column-reverse: scrollTop 0 = bottom, negative = scrolled up)", () => {
  it("treats scrollTop 0 as pinned to the bottom", () => {
    expect(isNearBottom(0)).toBe(true);
  });

  it("returns true within the default 100px threshold (scrollTop between -100 and 0)", () => {
    expect(isNearBottom(-50)).toBe(true);
    expect(isNearBottom(-100)).toBe(true);
  });

  it("returns false once scrolled up past the threshold (scrollTop < -100)", () => {
    expect(isNearBottom(-101)).toBe(false);
    expect(isNearBottom(-800)).toBe(false);
  });

  it("honours a custom threshold", () => {
    expect(isNearBottom(-40, 40)).toBe(true);
    expect(isNearBottom(-41, 40)).toBe(false);
  });
});

describe("computeAnchorAdjustment", () => {
  it("returns 0 when pinned to the bottom (scrollTop >= 0)", () => {
    expect(computeAnchorAdjustment(0, 120, false)).toBe(0);
    expect(computeAnchorAdjustment(-1, 120, false)).toBe(-120);
  });

  it("offsets scrollHeight growth while scrolled up", () => {
    expect(computeAnchorAdjustment(-500, 120, false)).toBe(-120);
  });

  it("offsets scrollHeight shrink in the opposite direction", () => {
    expect(computeAnchorAdjustment(-500, -40, false)).toBe(40);
  });

  it("returns 0 during programmatic scrolling", () => {
    expect(computeAnchorAdjustment(-500, 120, true)).toBe(0);
  });

  it("returns 0 when height did not change", () => {
    expect(computeAnchorAdjustment(-500, 0, false)).toBe(0);
  });
});

type Harness = {
  entries: ChatEntry[];
  loadingMore: boolean;
  thinking: boolean;
};

function createUserEntry(id: string): ChatEntry {
  return { kind: "user", id, text: `m-${id}` };
}

function setupHook(initialHeight: number) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let height = initialHeight;
  Object.defineProperty(container, "scrollHeight", {
    get: () => height,
    configurable: true,
  });
  container.scrollTo = vi.fn();

  const utils = renderHook(({ entries, loadingMore, thinking }: Harness) => useChatScroll(entries, "s1", loadingMore, thinking), {
    initialProps: { entries: [] as ChatEntry[], loadingMore: false, thinking: false },
  });
  utils.result.current.containerRef.current = container;

  return {
    ...utils,
    container,
    setHeight(next: number) {
      height = next;
    },
    streamFrame(entries: ChatEntry[]) {
      utils.rerender({ entries, loadingMore: false, thinking: false });
    },
  };
}

function scrollUp(container: HTMLElement, scrollTop: number) {
  container.scrollTop = scrollTop;
  container.dispatchEvent(new Event("scroll"));
}

describe("useChatScroll anchor compensation", () => {
  beforeEach(() => {
    useChatSessionStore.setState({ sessions: {} });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("keeps the viewport anchored when streaming grows content while scrolled up", () => {
    const harness = setupHook(2000);
    const first = [createUserEntry("e1")];
    harness.streamFrame(first);

    scrollUp(harness.container, -500);
    harness.setHeight(2120);
    harness.streamFrame([createUserEntry("e1b")]);

    expect(harness.container.scrollTop).toBe(-620);
  });

  it("does not adjust while pinned to the bottom (native follow stays intact)", () => {
    const harness = setupHook(2000);
    const first = [createUserEntry("e1")];
    harness.streamFrame(first);

    harness.setHeight(2120);
    harness.streamFrame([createUserEntry("e1b")]);

    expect(harness.container.scrollTop).toBe(0);
  });

  it("does not adjust during smooth scrollToBottom and resumes after the animation window", () => {
    vi.useFakeTimers();
    const harness = setupHook(2000);
    const first = [createUserEntry("e1")];
    harness.streamFrame(first);
    scrollUp(harness.container, -500);

    harness.streamFrame([...first, createUserEntry("e2")]);
    expect(harness.container.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });

    harness.setHeight(2120);
    harness.streamFrame([createUserEntry("e1"), createUserEntry("e2")]);
    expect(harness.container.scrollTop).toBe(-500);

    vi.advanceTimersByTime(700);
    harness.setHeight(2240);
    harness.streamFrame([createUserEntry("e1"), createUserEntry("e2")]);
    expect(harness.container.scrollTop).toBe(-620);
  });

  it("resumes compensation after a smooth scroll reaches the bottom and the user scrolls up again", () => {
    const harness = setupHook(2000);
    const first = [createUserEntry("e1")];
    harness.streamFrame(first);
    scrollUp(harness.container, -500);

    harness.streamFrame([...first, createUserEntry("e2")]);
    expect(harness.container.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });

    harness.container.scrollTop = 0;
    harness.container.dispatchEvent(new Event("scroll"));

    scrollUp(harness.container, -400);
    harness.setHeight(2120);
    harness.streamFrame([createUserEntry("e1"), createUserEntry("e2")]);
    expect(harness.container.scrollTop).toBe(-520);
  });

  it("compensates thinking indicator growth while scrolled up without an entries change", () => {
    const harness = setupHook(2000);
    const first = [createUserEntry("e1")];
    harness.streamFrame(first);
    scrollUp(harness.container, -500);

    harness.setHeight(2040);
    harness.rerender({ entries: first, loadingMore: false, thinking: true });
    expect(harness.container.scrollTop).toBe(-540);
  });

  it("restores the captured scrollTop after load-more even when height changed", () => {
    const harness = setupHook(2000);
    const first = [createUserEntry("e1")];
    harness.streamFrame(first);
    scrollUp(harness.container, -800);

    harness.rerender({ entries: first, loadingMore: true, thinking: false });
    harness.setHeight(3000);
    harness.rerender({ entries: [createUserEntry("e0"), ...first], loadingMore: false, thinking: false });

    expect(harness.container.scrollTop).toBe(-800);
  });
});
