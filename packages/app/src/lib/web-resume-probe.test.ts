import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupWebResumeProbe } from "./web-resume-probe";
import { useBusStore } from "../stores/bus-store";
import { useStreamingStore } from "../features/chat/runtime/streaming-store";

let resumeProbeSpy: ReturnType<typeof vi.fn>;
let resumeProbeAllSpy: ReturnType<typeof vi.fn>;
let dispose: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  resumeProbeSpy = vi.spyOn(useBusStore.getState(), "resumeProbe").mockReturnValue();
  resumeProbeAllSpy = vi.spyOn(useStreamingStore.getState(), "resumeProbeAll").mockReturnValue();
});

afterEach(() => {
  dispose?.();
  dispose = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function firePageshow(persisted: boolean) {
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted }));
}

describe("setupWebResumeProbe", () => {
  it("does not probe when the page was hidden shorter than the threshold", () => {
    dispose = setupWebResumeProbe();
    vi.setSystemTime(0);
    setVisibility("hidden");
    vi.setSystemTime(29_999);
    setVisibility("visible");
    expect(resumeProbeSpy).not.toHaveBeenCalled();
    expect(resumeProbeAllSpy).not.toHaveBeenCalled();
  });

  it("probes bus and all chat sessions when hidden >= threshold", () => {
    dispose = setupWebResumeProbe();
    vi.setSystemTime(0);
    setVisibility("hidden");
    vi.setSystemTime(30_000);
    setVisibility("visible");
    expect(resumeProbeSpy).toHaveBeenCalledTimes(1);
    expect(resumeProbeAllSpy).toHaveBeenCalledTimes(1);
  });

  it("probes on bfcache restore (pageshow persisted)", () => {
    dispose = setupWebResumeProbe();
    vi.setSystemTime(0);
    firePageshow(true);
    expect(resumeProbeSpy).toHaveBeenCalledTimes(1);
    expect(resumeProbeAllSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores non-persisted pageshow", () => {
    dispose = setupWebResumeProbe();
    firePageshow(false);
    expect(resumeProbeSpy).not.toHaveBeenCalled();
  });

  it("debounces probes within 10s", () => {
    dispose = setupWebResumeProbe();
    vi.setSystemTime(0);
    setVisibility("hidden");
    vi.setSystemTime(30_000);
    setVisibility("visible");
    expect(resumeProbeSpy).toHaveBeenCalledTimes(1);

    vi.setSystemTime(30_500);
    firePageshow(true);
    expect(resumeProbeSpy).toHaveBeenCalledTimes(1);

    vi.setSystemTime(50_000);
    firePageshow(true);
    expect(resumeProbeSpy).toHaveBeenCalledTimes(2);
  });

  it("stops listening after dispose", () => {
    dispose = setupWebResumeProbe();
    dispose();
    dispose = null;
    vi.setSystemTime(0);
    setVisibility("hidden");
    vi.setSystemTime(60_000);
    setVisibility("visible");
    firePageshow(true);
    expect(resumeProbeSpy).not.toHaveBeenCalled();
    expect(resumeProbeAllSpy).not.toHaveBeenCalled();
  });
});
