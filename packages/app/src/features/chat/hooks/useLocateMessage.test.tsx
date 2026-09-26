import { createRef } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import { useChatSessionStore } from "../runtime/session-store";
import { createSessionState, type ChatSessionState } from "../runtime/session-state";
import type { UserEntry } from "../model/entry";
import { useLocateMessage } from "./useLocateMessage";

const client = {} as ApiClient;

function seedSession(history: Partial<ChatSessionState["history"]>, seqs: number[]): void {
  const base = createSessionState("s1", "p1", "a1", 1);
  const entries = seqs.map(
    (seq): UserEntry => ({ kind: "user", id: `e${seq}`, seq, text: `m${seq}` }),
  );
  const session: ChatSessionState = {
    ...base,
    entries,
    history: { ...base.history, status: "ready", ...history },
  };
  useChatSessionStore.setState({ sessions: { s1: session } });
}

function mountAnchor(seq: number, container: HTMLElement): void {
  const anchor = document.createElement("div");
  anchor.setAttribute("data-entry-seq", String(seq));
  container.appendChild(anchor);
}

function setup(locateSeq: number | null) {
  const onLocated = vi.fn();
  const containerRef = createRef<HTMLDivElement>();
  const container = document.createElement("div");
  document.body.appendChild(container);
  containerRef.current = container;
  const locateRef = { current: locateSeq };
  const utils = renderHook(() =>
    useLocateMessage({
      containerRef,
      client,
      sessionId: "s1",
      agentId: "a1",
      locateSeq: locateRef.current,
      onLocated,
    }),
  );
  return { onLocated, container, containerRef, locateRef, ...utils };
}

describe("useLocateMessage", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    useChatSessionStore.setState({ sessions: {} });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("does nothing without a locate target", () => {
    seedSession({}, [0, 1, 2]);
    const { onLocated } = setup(null);
    expect(onLocated).not.toHaveBeenCalled();
  });

  it("scrolls to the anchor, highlights it and reports once when loaded", async () => {
    seedSession({ hasMore: true, oldestSeq: 0 }, [0, 1, 2]);
    const { onLocated, container } = setup(1);
    const scrollIntoView = vi.fn();
    const anchor = document.createElement("div");
    anchor.setAttribute("data-entry-seq", "1");
    anchor.scrollIntoView = scrollIntoView;
    container.appendChild(anchor);

    await waitFor(() => expect(onLocated).toHaveBeenCalledTimes(1));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(anchor.classList.contains("ring-2")).toBe(true);
  });

  it("keeps working when the anchor element is missing", async () => {
    seedSession({}, [0, 1, 2]);
    const { onLocated } = setup(1);
    await waitFor(() => expect(onLocated).toHaveBeenCalledTimes(1));
  });

  it("loads more history while the target is older than the loaded window", async () => {
    const loadMore = vi.fn();
    seedSession({ hasMore: true, oldestSeq: 5 }, [5, 6]);
    vi.spyOn(useChatSessionStore.getState(), "loadMore").mockImplementation(loadMore);
    const { onLocated } = setup(2);

    await waitFor(() => expect(loadMore).toHaveBeenCalledTimes(1));
    expect(onLocated).not.toHaveBeenCalled();
  });

  it("gives up when the target should be inside the loaded window but is absent", async () => {
    seedSession({ hasMore: true, oldestSeq: 0 }, [0, 1, 3]);
    const { onLocated } = setup(2);
    await waitFor(() => expect(onLocated).toHaveBeenCalledTimes(1));
  });

  it("gives up when history is exhausted without the target", async () => {
    seedSession({ hasMore: false, oldestSeq: 5 }, [5, 6]);
    const { onLocated } = setup(1);
    await waitFor(() => expect(onLocated).toHaveBeenCalledTimes(1));
  });

  it("gives up when history loading failed", async () => {
    seedSession({ hasMore: true, oldestSeq: 5, error: true }, [5, 6]);
    const { onLocated } = setup(1);
    await waitFor(() => expect(onLocated).toHaveBeenCalledTimes(1));
  });

  it("re-arms for a new target after a previous locate", async () => {
    seedSession({ hasMore: true, oldestSeq: 0 }, [0, 1, 2]);
    const { onLocated, container, locateRef, rerender } = setup(1);
    mountAnchor(1, container);
    await waitFor(() => expect(onLocated).toHaveBeenCalledTimes(1));

    mountAnchor(2, container);
    locateRef.current = 2;
    rerender();
    await waitFor(() => expect(onLocated).toHaveBeenCalledTimes(2));
  });

  it("re-locates the same seq after the param was cleared and set again", async () => {
    seedSession({}, [0, 1, 2]);
    const { onLocated, container, locateRef, rerender } = setup(1);
    mountAnchor(1, container);
    await waitFor(() => expect(onLocated).toHaveBeenCalledTimes(1));

    locateRef.current = null;
    rerender();
    locateRef.current = 1;
    rerender();
    await waitFor(() => expect(onLocated).toHaveBeenCalledTimes(2));
  });
});
