import type { Message } from "@spherse/core";
import type { AgentEvent } from "../model/agent-event-parse";
import { isAssistantMessage } from "../model/agent-event-parse";
import {
  commandCardFromResult,
  extractCardFromPartial,
  extractMessageText,
} from "../model/chat-tool-projection";
import type { ChatMessage, ToolCallInfo } from "../types";

export interface RunTail {
  active: boolean;
  startedAfterSeq: number | null;
  draft: ChatMessage | null;
  tools: ToolCallInfo[];
  retrying: boolean;
}

interface AgentMessageLike {
  content: Message["content"];
  timestamp?: number;
  stopReason?: string;
  errorMessage?: string;
}

export interface RunTailContext {
  highSeq: number | null;
  now: number;
}

export function initialRunTail(): RunTail {
  return {
    active: false,
    startedAfterSeq: null,
    draft: null,
    tools: [],
    retrying: false,
  };
}

export function reduceRunTail(run: RunTail, event: AgentEvent, ctx: RunTailContext): RunTail {
  switch (event.type) {
    case "agent_start":
    case "turn_start":
      return startRun(run, ctx);
    case "run_status":
      return event.active ? startRun(run, ctx) : endRun(run);
    case "agent_end":
      return endRun(run);
    case "message_start":
      return isAssistantMessage(event.message) ? applyMessageStart(run) : run;
    case "message_update":
      return isAssistantMessage(event.message) ? applyMessageUpdate(run, event.message.content) : run;
    case "message_end":
      return isAssistantMessage(event.message)
        ? applyMessageEnd(run, event.message, event.seq, ctx.now)
        : run;
    case "tool_execution_start": {
      const toolCall: ToolCallInfo = {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        status: "running",
      };
      return { ...run, tools: upsertTool(run.tools, toolCall) };
    }
    case "tool_execution_update":
      return { ...run, tools: updateTool(run.tools, event.toolCallId, (toolCall) => {
        const partialDetails = extractCardFromPartial(event.toolName, event.partialResult);
        const updated: ToolCallInfo = {
          ...toolCall,
          partialResult:
            typeof event.partialResult === "string" ? event.partialResult : JSON.stringify(event.partialResult),
        };
        if (partialDetails) {
          updated._card = partialDetails;
        }
        return updated;
      }) };
    case "tool_execution_end":
      return { ...run, tools: updateTool(run.tools, event.toolCallId, (toolCall) => {
        const updated: ToolCallInfo = {
          ...toolCall,
          status: event.isError ? ("error" as const) : ("completed" as const),
          result: typeof event.result === "string" ? event.result : JSON.stringify(event.result),
        };
        const finalCard = event.toolName === "run_command" ? commandCardFromResult(event.result, toolCall) : undefined;
        if (finalCard) updated._card = finalCard;
        return updated;
      }) };
    case "control_request":
      return applyControlRequest(run, event);
    case "control_resolved":
      return applyControlResolved(run, event);
    default:
      return run;
  }
}

function startRun(run: RunTail, ctx: RunTailContext): RunTail {
  if (run.active) return run;
  return { ...run, active: true, startedAfterSeq: ctx.highSeq, retrying: false };
}

function applyMessageStart(run: RunTail): RunTail {
  if (run.draft?._streaming) return run;
  return { ...run, draft: { role: "assistant", content: "", _streaming: true } };
}

function applyMessageUpdate(run: RunTail, content: Message["content"]): RunTail {
  const text = extractMessageText(content);
  if (run.draft?._streaming) {
    return { ...run, draft: { ...run.draft, content: text, _streaming: true } };
  }
  if (text) {
    return { ...run, draft: { role: "assistant", content: text, _streaming: true } };
  }
  return run;
}

function applyMessageEnd(run: RunTail, message: AgentMessageLike, seq: number | undefined, now: number): RunTail {
  if (seq !== undefined) {
    return { ...run, draft: null };
  }
  const text = extractMessageText(message.content);
  const isError = message.stopReason === "error";
  const error = isError ? (message.errorMessage ?? "Unknown error") : undefined;
  const timestamp = message.timestamp ?? now;
  if (run.draft?._streaming) {
    return {
      ...run,
      draft: {
        ...run.draft,
        content: text,
        _streaming: false,
        timestamp,
        ...(error ? { _error: error } : {}),
      },
    };
  }
  if (text || error) {
    return {
      ...run,
      draft: {
        role: "assistant",
        content: text,
        _streaming: false,
        timestamp,
        ...(error ? { _error: error } : {}),
      },
    };
  }
  return run;
}

function applyControlRequest(run: RunTail, event: Extract<AgentEvent, { type: "control_request" }>): RunTail {
  return { ...run, tools: updateTool(run.tools, event.toolCallId, (toolCall) => {
    if (event.kind === "approval") {
      return {
        ...toolCall,
        _card:
          toolCall.toolName === "run_command"
            ? {
                type: "command",
                status: "pending_approval",
                command: typeof toolCall.args.command === "string" ? toolCall.args.command : "",
                cwd: typeof toolCall.args.cwd === "string" ? toolCall.args.cwd : undefined,
                stdout: "",
                stderr: "",
                requestId: event.requestId,
              }
            : {
                type: "approval",
                status: "pending",
                toolName: toolCall.toolName,
                args: toolCall.args,
                requestId: event.requestId,
              },
      };
    }
    const filtered = Array.isArray(toolCall.args.options)
      ? toolCall.args.options.filter((s): s is string => typeof s === "string")
      : undefined;
    const options = filtered && filtered.length >= 2 ? filtered : undefined;
    return {
      ...toolCall,
      _card: {
        type: "question",
        status: "pending",
        question: typeof toolCall.args.question === "string" ? toolCall.args.question : "",
        options,
        requestId: event.requestId,
      },
    };
  }) };
}

function applyControlResolved(run: RunTail, event: Extract<AgentEvent, { type: "control_resolved" }>): RunTail {
  return { ...run, tools: run.tools.map((toolCall) => {
    const card = toolCall._card;
    if (!card || card.type === "html" || card.type === "image") return toolCall;
    if (card.requestId !== event.requestId) return toolCall;
    if (event.kind === "approval" && card.type === "approval") {
      return {
        ...toolCall,
        _card: {
          ...card,
          status: event.approved ? ("approved" as const) : ("rejected" as const),
          requestId: undefined,
        },
      };
    }
    if (event.kind === "approval" && card.type === "command") {
      return {
        ...toolCall,
        _card: event.approved
          ? { ...card, status: "running", requestId: undefined }
          : { ...card, status: "error", rejected: true, requestId: undefined },
      };
    }
    if (event.kind === "question" && card.type === "question") {
      return {
        ...toolCall,
        _card: event.timedOut
          ? { ...card, status: "timeout", requestId: undefined }
          : { ...card, status: "answered", answer: event.answer ?? "", requestId: undefined },
      };
    }
    return toolCall;
  }) };
}

export function settleDraft(run: RunTail): RunTail {
  if (!run.draft) return run;
  return { ...run, draft: null };
}

export function discardTransient(run: RunTail): RunTail {
  return { ...run, draft: null, tools: [], retrying: false };
}

export function markRetrying(run: RunTail): RunTail {
  return { ...run, retrying: true };
}

export function endRun(run: RunTail): RunTail {
  if (!run.active) return run;
  return {
    ...run,
    active: false,
    draft: run.draft ? { ...run.draft, _streaming: false } : null,
    tools: run.tools.map((toolCall) => (
      toolCall._card?.type === "question" && toolCall._card.requestId
        ? { ...toolCall, _card: undefined }
        : toolCall
    )),
  };
}

function upsertTool(tools: ToolCallInfo[], toolCall: ToolCallInfo): ToolCallInfo[] {
  const index = tools.findIndex((existing) => existing.toolCallId === toolCall.toolCallId);
  if (index < 0) return [...tools, toolCall];
  const next = [...tools];
  next[index] = toolCall;
  return next;
}

function updateTool(
  tools: ToolCallInfo[],
  toolCallId: string,
  update: (toolCall: ToolCallInfo) => ToolCallInfo,
): ToolCallInfo[] {
  let changed = false;
  const next = tools.map((toolCall) => {
    if (toolCall.toolCallId !== toolCallId) return toolCall;
    changed = true;
    return update(toolCall);
  });
  return changed ? next : tools;
}
