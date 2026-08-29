import { useEffect, useRef, useState } from "react";

interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SelectionState {
  text: string;
  position: { x: number; y: number };
  highlightRects: HighlightRect[];
}

const VIEWPORT_PADDING = 8;
const BUTTON_ESTIMATED_WIDTH = 112;
const BUTTON_ESTIMATED_HEIGHT = 32;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function toHighlightRect(rect: DOMRect): HighlightRect | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function getHighlightRects(range: Range): HighlightRect[] {
  const rects = Array.from(range.getClientRects())
    .map(toHighlightRect)
    .filter((rect): rect is HighlightRect => Boolean(rect));
  if (rects.length > 0) return rects;
  const fallback = toHighlightRect(range.getBoundingClientRect());
  return fallback ? [fallback] : [];
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest("input, textarea") !== null;
}

function getButtonPosition(event: MouseEvent) {
  const minX = VIEWPORT_PADDING + BUTTON_ESTIMATED_WIDTH / 2;
  const maxX = window.innerWidth - VIEWPORT_PADDING - BUTTON_ESTIMATED_WIDTH / 2;
  const x = clamp(event.clientX, minX, Math.max(minX, maxX));
  const y = clamp(
    event.clientY,
    VIEWPORT_PADDING,
    window.innerHeight - BUTTON_ESTIMATED_HEIGHT - VIEWPORT_PADDING,
  );
  return { x, y };
}

export function useTextSelection({
  disabled,
}: {
  disabled: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [selectionState, setSelectionState] = useState<SelectionState | null>(null);

  useEffect(() => {
    if (disabled) return;

    const handleMouseUp = (event: MouseEvent) => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setSelectionState(null);
        return;
      }

      const contentEl = contentRef.current;
      if (!contentEl || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      if (!contentEl.contains(range.commonAncestorContainer)) return;

      const text = selection.toString().trim();
      const highlightRects = getHighlightRects(range);
      if (highlightRects.length === 0) {
        setSelectionState(null);
        return;
      }

      setSelectionState({
        text,
        position: getButtonPosition(event),
        highlightRects,
      });
      selection.removeAllRanges();
    };

    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [disabled]);

  useEffect(() => {
    if (!selectionState) return;

    // handleMouseUp snapshots the selection and destroys the native one
    // (removeAllRanges), so Ctrl/Cmd+C alone has nothing to copy. While the
    // snapshot is alive, serve the shortcut from the snapshot, mirroring the
    // toolbar copy button.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "c") return;
      // Native copy inside editable targets (e.g. the start-session popover
      // comment box) must keep working untouched.
      if (isEditableTarget(event.target)) return;
      // A fresh native selection can coexist with the snapshot (Ctrl+A, or
      // dragging outside the content area, which skips the mouseup clear) —
      // let the native copy win instead of stale snapshot text.
      const nativeSelection = window.getSelection();
      if (nativeSelection && !nativeSelection.isCollapsed && nativeSelection.toString().trim()) return;
      event.preventDefault();
      navigator.clipboard
        .writeText(selectionState.text)
        .then(() => setSelectionState(null))
        .catch(() => {});
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectionState]);

  useEffect(() => {
    if (!selectionState) return;

    const clear = () => setSelectionState(null);
    const contentEl = contentRef.current;
    window.addEventListener("resize", clear);
    contentEl?.addEventListener("scroll", clear);
    return () => {
      window.removeEventListener("resize", clear);
      contentEl?.removeEventListener("scroll", clear);
    };
  }, [selectionState]);

  return {
    contentRef,
    selectionState,
    setSelectionState,
  };
}
