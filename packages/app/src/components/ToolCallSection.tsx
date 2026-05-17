import { useState } from "react";
import type { ToolCallInfo } from "../lib/types";

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
    <div className="mt-2 pt-2 border-t border-dashed border-[var(--border)]">
      {toolCalls.map((tc) => {
        const expanded = expandedIds.has(tc.toolCallId);
        const summary = getArgsSummary(tc.args);
        return (
          <div key={tc.toolCallId}>
            <button
              className="flex items-center gap-1.5 text-xs py-0.5 w-full text-left hover:bg-[var(--hover)] rounded px-1 -mx-1 transition-colors"
              onClick={() => toggle(tc.toolCallId)}
            >
              <span className="text-[10px] text-[var(--secondary)] select-none w-3 inline-block text-center">
                {expanded ? "▾" : "▸"}
              </span>
              <span className="font-mono bg-[var(--code-bg)] px-1 py-[1px] rounded-[2px]">
                {tc.toolName}
              </span>
              {summary && (
                <span className="text-[var(--secondary)] truncate max-w-[200px]">
                  → {summary}
                </span>
              )}
              <span className="ml-auto shrink-0">
                {tc.status === "running" && <span className="text-accent">...</span>}
                {tc.status === "completed" && <span className="text-success">✓</span>}
                {tc.status === "error" && <span className="text-danger">✗</span>}
              </span>
            </button>
            {expanded && (
              <div className="ml-4 mb-1.5 mt-0.5 text-xs">
                <table className="border-collapse">
                  <tbody>
                    {Object.entries(tc.args).map(([key, value]) => (
                      <tr key={key}>
                        <td className="py-0.5 pr-3 font-mono text-[var(--secondary)] align-top whitespace-nowrap">
                          {key}
                        </td>
                        <td className="py-0.5">
                          {(key === "path" || key === "file_path") && typeof value === "string" && onNavigateToPath ? (
                            <button
                              className="text-[var(--accent)] underline decoration-[var(--accent)] hover:opacity-80 text-left break-all whitespace-pre-wrap font-mono text-xs bg-transparent border-none p-0 cursor-pointer"
                              onClick={() => onNavigateToPath(value)}
                            >
                              {value}
                            </button>
                          ) : (
                            <code className="bg-[var(--code-bg)] px-1 py-[1px] rounded-[2px] break-all whitespace-pre-wrap">
                              {formatArgValue(value)}
                            </code>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
