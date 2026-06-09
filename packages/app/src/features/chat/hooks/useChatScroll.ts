import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../../lib/types";
import { useStreamingStore } from "../streaming-store";

const BOTTOM_THRESHOLD = 100;

export function useChatScroll(messages: ChatMessage[], sessionId: string) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);
  const restoredScroll = useRef(false);
  const prevCountRef = useRef(0);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const checkBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    setIsAtBottom(distanceFromBottom <= BOTTOM_THRESHOLD);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("scroll", checkBottom, { passive: true });
    checkBottom();
    return () => container.removeEventListener("scroll", checkBottom);
  }, [checkBottom, messages.length]);

  useEffect(() => {
    checkBottom();
  }, [messages, checkBottom]);

  useEffect(() => {
    if (messages.length === 0) return;

    const prevCount = prevCountRef.current;
    prevCountRef.current = messages.length;

    if (messages.length === prevCount) return;

    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === "user") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setIsAtBottom(true);
      initialScrollDone.current = true;
      return;
    }

    if (!isAtBottom) return;
    if (!initialScrollDone.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      initialScrollDone.current = true;
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isAtBottom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || messages.length === 0) return;

    if (!restoredScroll.current) {
      const saved = useStreamingStore.getState().sessions[sessionId]?.scrollPosition;
      if (saved && saved > 0) {
        container.scrollTop = saved;
      }
      restoredScroll.current = true;
    }
  }, [sessionId, messages.length]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return () => {
      useStreamingStore.getState().setScrollPosition(sessionId, container.scrollTop);
    };
  }, [sessionId]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setIsAtBottom(true);
  }, []);

  return { messagesEndRef, containerRef, isAtBottom, scrollToBottom };
}
