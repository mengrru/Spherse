import { cn } from "@/lib/utils";

interface FrontMatterPanelProps {
  data: Record<string, unknown>;
  className?: string;
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderValue(item)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}

export function FrontMatterPanel({ data, className }: FrontMatterPanelProps) {
  const entries = Object.entries(data)
    .map(([key, value]) => [key, renderValue(value)] as const)
    .filter(([, text]) => text.length > 0);

  if (entries.length === 0) {
    return null;
  }

  return (
    <dl
      className={cn(
        "mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-border bg-muted/40 p-3 text-xs",
        className,
      )}
    >
      {entries.map(([key, text]) => (
        <div key={key} className="contents">
          <dt className="font-medium text-muted-foreground">{key}</dt>
          <dd className="break-words text-foreground">{text}</dd>
        </div>
      ))}
    </dl>
  );
}
