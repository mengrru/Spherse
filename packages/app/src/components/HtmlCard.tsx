import type { HtmlCard } from "../lib/types";

interface HtmlCardRendererProps {
  card: HtmlCard;
}

export function HtmlCardRenderer({ card }: HtmlCardRendererProps) {
  const width = card.width ? `${Math.min(card.width, card.max_width ?? 800)}px` : "100%";
  const height = Math.min(card.height ?? 400, card.max_height ?? 600);

  return (
    <div
      className="my-2 rounded-lg border border-[var(--border)] overflow-hidden"
      style={{ maxWidth: `${card.max_width ?? 800}px`, width }}
    >
      {card.title && (
        <div className="px-3 py-1.5 text-xs font-semibold bg-[var(--muted-bg)] text-[var(--secondary)] border-b border-[var(--border)]">
          {card.title}
        </div>
      )}
      <iframe
        srcDoc={card.html}
        sandbox="allow-scripts allow-same-origin"
        style={{
          width: "100%",
          height: `${height}px`,
          border: "none",
          display: "block",
        }}
      />
    </div>
  );
}
