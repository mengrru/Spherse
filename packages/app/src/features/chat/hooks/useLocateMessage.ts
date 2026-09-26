import { useEffect, useRef, type RefObject } from "react";
import type { ApiClient } from "../../../lib/api";
import type { ChatEntry } from "../model/entry";
import { useChatSessionStore } from "../runtime/session-store";

const HIGHLIGHT_CLASSES = ["rounded-lg", "ring-2", "ring-primary", "ring-offset-2"];
const HIGHLIGHT_MS = 2000;

const NO_ENTRIES: ChatEntry[] = [];

interface UseLocateMessageParams {
  containerRef: RefObject<HTMLDivElement | null>;
  client: ApiClient;
  sessionId: string;
  agentId: string;
  locateSeq: number | null;
  onLocated: () => void;
}

export function useLocateMessage({
  containerRef,
  client,
  sessionId,
  agentId,
  locateSeq,
  onLocated,
}: UseLocateMessageParams) {
  const handledSeqRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLocatedRef = useRef(onLocated);

  useEffect(() => {
    onLocatedRef.current = onLocated;
  }, [onLocated]);

  const session = useChatSessionStore((state) => state.sessions[sessionId]);
  const entries = session?.entries ?? NO_ENTRIES;
  const history = session?.history;

  const targetLoaded =
    locateSeq !== null && entries.some((entry) => entry.seq === locateSeq);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (locateSeq === null || handledSeqRef.current === locateSeq) return;

    if (targetLoaded) {
      const seq = locateSeq;
      const raf = requestAnimationFrame(() => {
        handledSeqRef.current = seq;
        const anchor = containerRef.current?.querySelector<HTMLElement>(
          `[data-entry-seq="${seq}"]`,
        );
        anchor?.scrollIntoView({ block: "center" });
        if (anchor) {
          anchor.classList.add(...HIGHLIGHT_CLASSES);
          if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
          highlightTimerRef.current = setTimeout(() => {
            anchor.classList.remove(...HIGHLIGHT_CLASSES);
          }, HIGHLIGHT_MS);
        }
        onLocatedRef.current();
      });
      return () => cancelAnimationFrame(raf);
    }

    if (history?.error) {
      handledSeqRef.current = locateSeq;
      onLocatedRef.current();
      return;
    }

    const oldestSeq = history?.oldestSeq ?? null;
    const historyReady = history?.status === "ready";

    if (oldestSeq !== null && locateSeq >= oldestSeq) {
      handledSeqRef.current = locateSeq;
      onLocatedRef.current();
      return;
    }

    if (historyReady && history?.hasMore === false) {
      handledSeqRef.current = locateSeq;
      onLocatedRef.current();
      return;
    }

    if (history?.hasMore && !history.loadingMore && oldestSeq !== null && oldestSeq > locateSeq) {
      useChatSessionStore.getState().loadMore(client, sessionId, agentId);
    }
  }, [locateSeq, targetLoaded, history, client, sessionId, agentId, containerRef]);
}
