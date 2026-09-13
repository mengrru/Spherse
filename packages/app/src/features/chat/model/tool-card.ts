import type { ToolCall as AgentToolCall } from "@spherse/core";
import type { ChatCard } from "../types";
import {
  buildCardFromToolResult,
  extractCardFromPartial,
} from "./chat-tool-projection";
import type { ControlProjection, ToolResultEntry } from "./entry";

const cardCache = new WeakMap<object, ChatCard | null>();

export function projectToolCard(
  toolName: string,
  args: Record<string, unknown>,
  result: ToolResultEntry,
): ChatCard | undefined {
  const cached = cardCache.get(result);
  if (cached !== undefined) return cached ?? undefined;
  const card = computeToolCard(toolName, args, result) ?? null;
  cardCache.set(result, card);
  return card ?? undefined;
}

function computeToolCard(
  toolName: string,
  args: Record<string, unknown>,
  result: ToolResultEntry,
): ChatCard | undefined {
  const control = result.control;
  if (control?.status === "pending") {
    const pending = controlCard(control, toolName, args);
    if (pending) return pending;
  }
  const details = resolveDetails(result);
  if (result.result !== undefined || details !== undefined) {
    const fromResult = buildCardFromToolResult(toolName, agentToolCall(toolName, args), details);
    if (fromResult) return fromResult;
  }
  if (result.partialResult !== undefined) {
    const fromPartial = extractCardFromPartial(toolName, result.partialResult);
    if (fromPartial) return fromPartial;
  }
  return control ? controlCard(control, toolName, args) : undefined;
}

function resolveDetails(result: ToolResultEntry): unknown {
  if (result.details !== undefined) return result.details;
  if (isObject(result.result) && "details" in result.result) {
    return (result.result as { details?: unknown }).details;
  }
  return undefined;
}

function controlCard(
  control: ControlProjection,
  toolName: string,
  args: Record<string, unknown>,
): ChatCard | undefined {
  if (control.kind === "approval") {
    if (toolName === "run_command") {
      const command = typeof args.command === "string" ? args.command : "";
      const cwd = typeof args.cwd === "string" ? args.cwd : undefined;
      if (control.status === "pending") {
        return { type: "command", status: "pending_approval", command, cwd, stdout: "", stderr: "", requestId: control.requestId };
      }
      if (control.status === "approved") {
        return { type: "command", status: "running", command, cwd, stdout: "", stderr: "" };
      }
      if (control.status === "rejected") {
        return { type: "command", status: "error", rejected: true, command, cwd, stdout: "", stderr: "" };
      }
      return undefined;
    }
    if (control.status === "pending") {
      return { type: "approval", status: "pending", toolName, args, requestId: control.requestId };
    }
    if (control.status === "approved") {
      return { type: "approval", status: "approved", toolName, args };
    }
    if (control.status === "rejected") {
      return { type: "approval", status: "rejected", toolName, args };
    }
    return undefined;
  }
  const question = typeof args.question === "string" ? args.question : "";
  const options = questionOptions(args);
  if (control.status === "pending") {
    return { type: "question", status: "pending", question, options, requestId: control.requestId };
  }
  if (control.status === "answered") {
    return { type: "question", status: "answered", question, options, answer: control.answer ?? "" };
  }
  if (control.status === "timeout") {
    return { type: "question", status: "timeout", question, options };
  }
  return undefined;
}

function questionOptions(args: Record<string, unknown>): string[] | undefined {
  if (!Array.isArray(args.options)) return undefined;
  const options = args.options.filter((value): value is string => typeof value === "string");
  return options.length >= 2 ? options : undefined;
}

function agentToolCall(toolName: string, args: Record<string, unknown>): AgentToolCall {
  return { type: "toolCall", id: "", name: toolName, arguments: args };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
