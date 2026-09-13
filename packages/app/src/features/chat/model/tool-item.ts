import type { ChatCard } from "../types";
import type { ToolResultEntry } from "./entry";
import { projectToolCard } from "./tool-card";

export interface ToolItem {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: "running" | "completed" | "error";
  result?: string;
  partialResult?: string;
  card?: ChatCard;
}

export function mergeToolResult(tools: ToolItem[], result: ToolResultEntry): void {
  const index = tools.findIndex((tool) => tool.toolCallId === result.toolCallId);
  if (index >= 0) {
    tools[index] = finalizeToolItem(tools[index], result);
    return;
  }
  tools.push(toolItemFromResult(result));
}

export function toolItemFromResult(result: ToolResultEntry): ToolItem {
  const args = result.args ?? {};
  const toolName = result.toolName ?? "";
  const item: ToolItem = {
    toolCallId: result.toolCallId,
    toolName,
    args,
    status: result.isError ? "error" : "completed",
  };
  const displayResult = displayValue(result.result);
  if (displayResult !== undefined) item.result = displayResult;
  const displayPartial = displayValue(result.partialResult);
  if (displayPartial !== undefined) item.partialResult = displayPartial;
  const card = projectToolCard(toolName, args, result);
  if (card) item.card = card;
  return item;
}

function finalizeToolItem(previous: ToolItem, result: ToolResultEntry): ToolItem {
  const toolName = previous.toolName || result.toolName || "";
  const args = Object.keys(previous.args).length > 0 ? previous.args : result.args ?? {};
  const item: ToolItem = {
    toolCallId: previous.toolCallId,
    toolName,
    args,
    status: result.isError ? "error" : "completed",
  };
  const displayResult = displayValue(result.result);
  if (displayResult !== undefined) item.result = displayResult;
  const displayPartial = displayValue(result.partialResult);
  if (displayPartial !== undefined) item.partialResult = displayPartial;
  const card = projectToolCard(toolName, args, result);
  if (card) item.card = card;
  return item;
}

function displayValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value);
}
