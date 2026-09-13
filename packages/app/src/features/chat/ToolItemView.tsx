import { useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { ChevronRightIcon, CheckIcon, XIcon } from "lucide-react";
import type { ToolItem } from "./model/tool-item";

interface ToolItemViewProps {
  tool: ToolItem;
  onNavigateToPath?: (path: string) => void;
}

function getArgsSummary(args: Record<string, unknown>): string {
  const priorityKeys = ["path", "name", "content", "query", "message", "text", "file"];
  for (const key of priorityKeys) {
    if (args[key] != null) {
      const val = String(args[key]);
      return val.length > 40 ? val.slice(0, 40) + "…" : val;
    }
  }
  const keys = Object.keys(args);
  if (keys.length === 0) return "";
  return keys.join(", ");
}

function formatArgValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function ToolItemView({ tool, onNavigateToPath }: ToolItemViewProps) {
  const [expanded, setExpanded] = useState(false);
  const summary = getArgsSummary(tool.args);

  return (
    <Collapsible open={expanded}>
      <CollapsibleTrigger
        render={<Button variant="ghost" className="-mx-1 h-auto w-full justify-start px-1 py-0.5" />}
        onClick={() => setExpanded((value) => !value)}
      >
        <span
          className="inline-flex size-3 items-center justify-center text-muted-foreground transition-transform"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          <ChevronRightIcon className="size-3" />
        </span>
        <Badge variant="outline" className="font-mono">
          {tool.toolName}
        </Badge>
        {summary && (
          <span className="max-w-[200px] truncate text-xs text-muted-foreground">
            → {summary}
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs">
          {tool.status === "running" && <span className="text-accent">...</span>}
          {tool.status === "completed" && <CheckIcon className="size-3" />}
          {tool.status === "error" && <XIcon className="size-3 text-destructive" />}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 mt-0.5 mb-1.5 text-xs">
          <table className="border-collapse">
            <tbody>
              {Object.entries(tool.args).map(([key, value]) => (
                <tr key={key}>
                  <td className="py-0.5 pr-3 align-top font-mono whitespace-nowrap text-muted-foreground">
                    {key}
                  </td>
                  <td className="py-0.5">
                    {(key === "path" || key === "file_path") && typeof value === "string" && onNavigateToPath ? (
                      <button
                        className="cursor-pointer border-none bg-transparent p-0 text-left font-mono text-xs whitespace-pre-wrap text-primary underline hover:opacity-80"
                        onClick={() => onNavigateToPath(value)}
                      >
                        {value}
                      </button>
                    ) : (
                      <code className="block max-h-60 overflow-y-auto rounded bg-muted px-1 py-[1px] break-all whitespace-pre-wrap">
                        {formatArgValue(value)}
                      </code>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
