import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types";
import { useStreamingStore } from "../streaming-store";

const SCROLL_THROTTLE_MS = 1000;
const NEAR_BOTTOM_THRESHOLD = 100;

export function shouldStickToBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
): boolean {
  if (clientHeight <= 0) return true;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  return distanceFromBottom <= clientHeight / 3;
}

export function useChatScroll(
  messages: ChatMessage[],
  sessionId: string,
  streaming: boolean,
  loadingMore: boolean = false,
) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const stickToBottomRef = useRef(true);

  const restoredScrollRef = useRef(false);
  const prevCountRef = useRef(0);

  const prevScrollHeightRef = useRef(0);
  const pendingLoadingMoreRef = useRef(false);

  const prevStreamingRef = useRef(streaming);
  const lastAutoScrollAtRef = useRef(0);
  const scrollTopRef = useRef(0);

  const streamingRef = useRef(streaming);
  useEffect(() => {
    streamingRef.current = streaming;
  });

  const syncBottomState = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    scrollTopRef.current = container.scrollTop;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD;
    stickToBottomRef.current = shouldStickToBottom(
      container.scrollHeight,
      container.scrollTop,
      container.clientHeight,
    );
    setIsAtBottom((prev) => (prev === nearBottom ? prev : nearBottom));
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
    stickToBottomRef.current = true;
    setIsAtBottom(true);
    lastAutoScrollAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("scroll", syncBottomState, { passive: true });
    syncBottomState();
    return () => container.removeEventListener("scroll", syncBottomState);
  }, [syncBottomState]);

  useEffect(() => {
    restoredScrollRef.current = false;
    prevCountRef.current = 0;
    prevScrollHeightRef.current = 0;
    pendingLoadingMoreRef.current = false;
    lastAutoScrollAtRef.current = 0;
    stickToBottomRef.current = true;
    prevStreamingRef.current = streamingRef.current;
  }, [sessionId]);

  useEffect(() => {
    if (loadingMore && containerRef.current) {
      prevScrollHeightRef.current = containerRef.current.scrollHeight;
      pendingLoadingMoreRef.current = true;
    }
  }, [loadingMore]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || messages.length === 0) return;

    if (pendingLoadingMoreRef.current) {
      const delta = container.scrollHeight - prevScrollHeightRef.current;
      if (delta !== 0) container.scrollTop += delta;
      pendingLoadingMoreRef.current = false;
      prevCountRef.current = messages.length;
      syncBottomState();
      return;
    }

    if (!restoredScrollRef.current) {
      restoredScrollRef.current = true;
      const saved = useStreamingStore
        .getState()
        .sessions[sessionId]?.scrollPosition;
      if (saved && saved > 0) {
        container.scrollTop = saved;
        syncBottomState();
      } else {
        scrollToBottom("instant");
      }
      prevCountRef.current = messages.length;
      return;
    }

    const prevCount = prevCountRef.current;
    prevCountRef.current = messages.length;
    const lastMsg = messages[messages.length - 1];

    if (messages.length > prevCount && lastMsg?.role === "user") {
      scrollToBottom("smooth");
      return;
    }

    if (!stickToBottomRef.current) return;
    const now = Date.now();
    if (now - lastAutoScrollAtRef.current >= SCROLL_THROTTLE_MS) {
      scrollToBottom("smooth");
    }
  }, [messages, sessionId, scrollToBottom, syncBottomState]);

  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (wasStreaming && !streaming && stickToBottomRef.current) {
      scrollToBottom("smooth");
    }
  }, [streaming, scrollToBottom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return () => {
      useStreamingStore
        .getState()
        .setScrollPosition(sessionId, scrollTopRef.current);
    };
  }, [sessionId]);

  return { messagesEndRef, containerRef, isAtBottom, scrollToBottom };
}
