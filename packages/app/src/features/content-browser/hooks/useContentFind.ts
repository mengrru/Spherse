import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import {
  applyHighlight,
  buildRange,
  clearHighlight,
  collectText,
  type Match,
  findMatches,
  scrollRangeIntoView,
} from "./find-engine";

const DEBOUNCE_MS = 150;

export interface ContentFindApi {
  query: string;
  setQuery: (q: string) => void;
  matchIndex: number;
  matchCount: number;
  overLimit: boolean;
  next: () => void;
  prev: () => void;
}

interface UseContentFindOptions {
  contentKey: string;
  containerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Find-in-content engine bound to a scroll container. The hook is always active
 * while mounted — mount/unmount is the caller's responsibility (render the host
 * component only while the find bar should be open).
 */
export function useContentFind({ contentKey, containerRef }: UseContentFindOptions): ContentFindApi {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchIndex, setMatchIndex] = useState(-1);
  const [overLimit, setOverLimit] = useState(false);
  const markRef = useRef<HTMLElement | null>(null);

  const needle = query.trim();

  useEffect(() => {
    setMatches([]);
    setMatchIndex(-1);
    setOverLimit(false);
  }, [contentKey]);

  useEffect(() => {
    if (!needle) {
      setMatches([]);
      setMatchIndex(-1);
      setOverLimit(false);
      return;
    }
    const handle = window.setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      const { text } = collectText(container);
      const { matches: found, overLimit: limited } = findMatches(text, needle);
      setMatches(found);
      setOverLimit(limited);
      setMatchIndex(found.length > 0 ? 0 : -1);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [needle, contentKey, containerRef]);

  useEffect(() => {
    clearHighlight(markRef);
    if (matchIndex < 0 || matchIndex >= matches.length) return;
    const container = containerRef.current;
    if (!container) return;
    // Re-collect nodes on every apply: the <mark> fallback mutates the DOM
    // (surroundContents + normalize on clear), which invalidates previously
    // captured text-node references. Global offsets in `matches` stay valid
    // because the restored text content is identical.
    const { nodes } = collectText(container);
    if (nodes.length === 0) return;
    const range = buildRange(nodes, matches[matchIndex]);
    if (!range) return;
    applyHighlight(range, markRef);
    scrollRangeIntoView(container, range);
    return () => clearHighlight(markRef);
  }, [matchIndex, matches, contentKey, containerRef]);

  useEffect(() => () => clearHighlight(markRef), []);

  const next = useCallback(() => {
    setMatchIndex((i) => (matches.length === 0 ? -1 : (i + 1) % matches.length));
  }, [matches.length]);

  const prev = useCallback(() => {
    setMatchIndex((i) => (matches.length === 0 ? -1 : (i - 1 + matches.length) % matches.length));
  }, [matches.length]);

  return {
    query,
    setQuery,
    matchIndex,
    matchCount: matches.length,
    overLimit,
    next,
    prev,
  };
}
