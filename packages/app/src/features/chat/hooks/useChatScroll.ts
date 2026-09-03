import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RenderItem } from "../types";
import { useStreamingStore } from "../runtime/streaming-store";

const NEAR_BOTTOM_THRESHOLD = 100;

export function isNearBottom(scrollTop: number, threshold: number = NEAR_BOTTOM_THRESHOLD): boolean {
  return scrollTop >= -threshold;
}

export function useChatScroll(items: RenderItem[], sessionId: string, loadingMore: boolean = false) {
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

  const hasMessages = items.length > 0;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("scroll", syncBottomState, { passive: true });
    syncBottomState();
    return () => container.removeEventListener("scroll", syncBottomState);
  }, [syncBottomState, hasMessages]);

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
    if (!container || items.length === 0) return;

    if (!restoredScrollRef.current) {
      restoredScrollRef.current = true;
      const saved = useStreamingStore.getState().sessions[sessionId]?.scrollPosition;
      if (saved && saved < 0) {
        container.scrollTop = saved;
        syncBottomState();
      } else {
        scrollToBottom("instant");
      }
      prevCountRef.current = items.length;
      return;
    }

    if (pendingLoadingMoreRef.current) {
      pendingLoadingMoreRef.current = false;
      prevCountRef.current = items.length;
      if (preLoadMoreScrollTopRef.current !== null) {
        container.scrollTop = preLoadMoreScrollTopRef.current;
        scrollTopRef.current = preLoadMoreScrollTopRef.current;
        preLoadMoreScrollTopRef.current = null;
        syncBottomState();
      }
      return;
    }

    const prevCount = prevCountRef.current;
    prevCountRef.current = items.length;
    const lastMsg = items[items.length - 1]?.message;

    if (items.length > prevCount && lastMsg?.role === "user") {
      scrollToBottom("smooth");
      return;
    }
  }, [items, sessionId, scrollToBottom, syncBottomState]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return () => {
      useStreamingStore.getState().setScrollPosition(sessionId, scrollTopRef.current);
    };
  }, [sessionId]);

  return { containerRef, isAtBottom, scrollToBottom };
}
