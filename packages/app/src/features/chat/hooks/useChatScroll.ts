import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../../lib/types";

const BOTTOM_THRESHOLD = 100;

export function useChatScroll(messages: ChatMessage[]) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);
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
    if (!isAtBottom) return;
    if (!initialScrollDone.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      initialScrollDone.current = true;
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isAtBottom]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setIsAtBottom(true);
  }, []);

  return { messagesEndRef, containerRef, isAtBottom, scrollToBottom };
}
