import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatEntry } from "../model/entry";
import { useChatSessionStore } from "../runtime/session-store";

const NEAR_BOTTOM_THRESHOLD = 100;

export function isNearBottom(scrollTop: number, threshold: number = NEAR_BOTTOM_THRESHOLD): boolean {
  return scrollTop >= -threshold;
}

export function useChatScroll(entries: ChatEntry[], sessionId: string, loadingMore: boolean = false) {
  const containerRef = useRef<HTMLDivElement>(null);

  const [isAtBottom, setIsAtBottom] = useState(true);

  const restoredScrollRef = useRef(false);
  const prevCountRef = useRef(0);
  const scrollTopRef = useRef(0);
  const pendingLoadingMoreRef = useRef(false);
  const preLoadMoreScrollTopRef = useRef<number | null>(null);

  const syncBottomState = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    scrollTopRef.current = container.scrollTop;
    const nearBottom = isNearBottom(container.scrollTop);
    setIsAtBottom((prev) => (prev === nearBottom ? prev : nearBottom));
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ top: 0, behavior });
    scrollTopRef.current = 0;
    setIsAtBottom(true);
  }, []);

  const hasEntries = entries.length > 0;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("scroll", syncBottomState, { passive: true });
    syncBottomState();
    return () => container.removeEventListener("scroll", syncBottomState);
  }, [syncBottomState, hasEntries]);

  useEffect(() => {
    restoredScrollRef.current = false;
    prevCountRef.current = 0;
    pendingLoadingMoreRef.current = false;
    preLoadMoreScrollTopRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (loadingMore) {
      pendingLoadingMoreRef.current = true;
      const container = containerRef.current;
      if (container) preLoadMoreScrollTopRef.current = container.scrollTop;
    } else {
      // clear stale capture if the fetch failed without a messages change
      pendingLoadingMoreRef.current = false;
      preLoadMoreScrollTopRef.current = null;
    }
  }, [loadingMore]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || entries.length === 0) return;

    if (!restoredScrollRef.current) {
      restoredScrollRef.current = true;
      const saved = useChatSessionStore.getState().sessions[sessionId]?.scrollPosition;
      if (saved && saved < 0) {
        container.scrollTop = saved;
        syncBottomState();
      } else {
        scrollToBottom("instant");
      }
      prevCountRef.current = entries.length;
      return;
    }

    if (pendingLoadingMoreRef.current) {
      pendingLoadingMoreRef.current = false;
      prevCountRef.current = entries.length;
      if (preLoadMoreScrollTopRef.current !== null) {
        container.scrollTop = preLoadMoreScrollTopRef.current;
        scrollTopRef.current = preLoadMoreScrollTopRef.current;
        preLoadMoreScrollTopRef.current = null;
        syncBottomState();
      }
      return;
    }

    const prevCount = prevCountRef.current;
    prevCountRef.current = entries.length;
    const lastIsUser = entries[entries.length - 1]?.kind === "user";

    if (entries.length > prevCount && lastIsUser) {
      scrollToBottom("smooth");
      return;
    }
  }, [entries, sessionId, scrollToBottom, syncBottomState]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return () => {
      useChatSessionStore.getState().setScrollPosition(sessionId, scrollTopRef.current);
    };
  }, [sessionId]);

  return { containerRef, isAtBottom, scrollToBottom };
}
