export const MAX_MATCHES = 2000;
export const FIND_HIGHLIGHT_KEY = "sp-find-current";

export interface Match {
  start: number;
  end: number;
}

interface TextNodeRange {
  node: Text;
  start: number;
  end: number;
}

export function collectText(root: HTMLElement): { text: string; nodes: TextNodeRange[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: TextNodeRange[] = [];
  let text = "";
  let current = walker.nextNode() as Text | null;
  while (current) {
    const len = current.data.length;
    if (len > 0) {
      nodes.push({ node: current, start: text.length, end: text.length + len });
      text += current.data;
    }
    current = walker.nextNode() as Text | null;
  }
  return { text, nodes };
}

export function findMatches(text: string, needle: string): { matches: Match[]; overLimit: boolean } {
  const matches: Match[] = [];
  if (!needle) return { matches, overLimit: false };
  const lower = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let from = 0;
  while (matches.length < MAX_MATCHES) {
    const idx = lower.indexOf(lowerNeedle, from);
    if (idx === -1) break;
    matches.push({ start: idx, end: idx + lowerNeedle.length });
    from = idx + lowerNeedle.length;
  }
  const overLimit = lower.indexOf(lowerNeedle, from) !== -1;
  return { matches, overLimit };
}

function locate(nodes: TextNodeRange[], globalOffset: number): { node: Text; offset: number } | null {
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const n = nodes[mid];
    if (globalOffset < n.start) hi = mid - 1;
    else if (globalOffset >= n.end) lo = mid + 1;
    else return { node: n.node, offset: globalOffset - n.start };
  }
  const edge = nodes.find((n) => n.end === globalOffset);
  return edge ? { node: edge.node, offset: edge.node.length } : null;
}

export function buildRange(nodes: TextNodeRange[], m: Match): Range | null {
  const start = locate(nodes, m.start);
  const end = locate(nodes, m.end);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

export function applyHighlight(range: Range, markHolder: { current: HTMLElement | null }): void {
  // CSS Custom Highlight API is the primary path (no DOM mutation). The <mark>
  // surroundContents branch is a fallback for environments without `Highlight`
  // (e.g. jsdom, legacy browsers); it mutates the DOM, so callers must
  // re-collect text nodes after clearing (see useContentFind apply effect).
  ensureHighlightStyle();
  const supportsHighlight =
    typeof CSS !== "undefined" &&
    typeof Highlight !== "undefined" &&
    typeof CSS.highlights !== "undefined";
  if (supportsHighlight) {
    try {
      CSS.highlights.set(FIND_HIGHLIGHT_KEY, new Highlight(range));
      return;
    } catch {
      // fall through to mark-based highlight
    }
  }
  if (
    range.startContainer === range.endContainer &&
    range.startContainer.nodeType === Node.TEXT_NODE
  ) {
    try {
      const mark = document.createElement("mark");
      mark.className = "sp-find-mark";
      range.surroundContents(mark);
      markHolder.current = mark;
    } catch {
      // cross-boundary matches skip highlight (still scrolled into view)
    }
  }
}

export function clearHighlight(markHolder: { current: HTMLElement | null }): void {
  const mark = markHolder.current;
  if (mark && mark.parentNode) {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
  markHolder.current = null;
  if (typeof CSS !== "undefined" && typeof CSS.highlights !== "undefined") {
    CSS.highlights.delete(FIND_HIGHLIGHT_KEY);
  }
}

export function scrollRangeIntoView(container: HTMLElement | null, range: Range): void {
  if (!container) return;
  let rect: DOMRect;
  try {
    rect = range.getBoundingClientRect();
  } catch {
    return; // non-layout environments (e.g. jsdom) — skip scrolling
  }
  if (rect.width === 0 && rect.height === 0) return;
  const cRect = container.getBoundingClientRect();
  container.scrollTop += rect.top - cRect.top - cRect.height / 2;
}

const HIGHLIGHT_STYLE_ID = "sp-find-highlight-style";

/**
 * Injects the `::highlight(sp-find-current)` style once. Done at runtime
 * because the build's CSS optimizer (lightningcss via Tailwind v4) does not
 * recognize the Custom Highlight API pseudo-element and emits a warning / risks
 * dropping the rule. The CSS variables resolve against `:root` at runtime.
 */
function ensureHighlightStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `::highlight(${FIND_HIGHLIGHT_KEY}){background-color:var(--color-primary);color:var(--color-primary-foreground)}`;
  document.head.append(style);
}
