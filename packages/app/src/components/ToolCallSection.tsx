import { useState } from "react";
import type { ToolCallInfo } from "../lib/types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { ChevronRightIcon, CheckIcon, XIcon } from "lucide-react";

interface ToolCallSectionProps {
  toolCalls: ToolCallInfo[];
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

export function ToolCallSection({ toolCalls, onNavigateToPath }: ToolCallSectionProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="mt-2 border-t border-dashed border-border pt-2">
      {toolCalls.map((tc) => {
        const expanded = expandedIds.has(tc.toolCallId);
        const summary = getArgsSummary(tc.args);
        return (
          <Collapsible key={tc.toolCallId} open={expanded}>
            <CollapsibleTrigger
              render={<Button variant="ghost" className="-mx-1 h-auto w-full justify-start px-1 py-0.5" />}
              onClick={() => toggle(tc.toolCallId)}
            >
              <span
                className="inline-flex size-3 items-center justify-center text-muted-foreground transition-transform"
                style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
              >
                <ChevronRightIcon className="size-3" />
              </span>
              <Badge variant="outline" className="font-mono">
                {tc.toolName}
              </Badge>
              {summary && (
                <span className="max-w-[200px] truncate text-xs text-muted-foreground">
                  → {summary}
                </span>
              )}
              <span className="ml-auto shrink-0 text-xs">
                {tc.status === "running" && <span className="text-accent">...</span>}
                {tc.status === "completed" && <CheckIcon className="size-3" />}
                {tc.status === "error" && <XIcon className="size-3 text-destructive" />}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="ml-4 mt-0.5 mb-1.5 text-xs">
                <table className="border-collapse">
                  <tbody>
                    {Object.entries(tc.args).map(([key, value]) => (
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
                            <code className="rounded bg-muted px-1 py-[1px] break-all whitespace-pre-wrap">
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
      })}
    </div>
  );
}
