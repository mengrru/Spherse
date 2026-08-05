import type {
  AssistantMessage,
  ImageCardDetails,
  Message,
  RenderCardDetails,
  ToolCall as AgentToolCall,
} from "@spherse/core";
import {
  isCommandCardDetails,
  isImageCardDetails,
  isImageCardResultDetails,
  isRejectedToolDetails,
  isRenderCardDetails,
  isRenderCardResultDetails,
  isTextContent,
  isToolCall,
} from "./agent-event-parse";
import type { ChatCard, CommandCard, ToolCallInfo } from "../types";

export function extractMessageText(content: Message["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(isTextContent).map((item) => item.text).join("");
}

export function extractToolCalls(
  message: AssistantMessage,
): ToolCallInfo[] | undefined {
  if (!Array.isArray(message.content)) return undefined;
  const toolCalls = message.content.filter(isToolCall);
  return toolCalls.length > 0
    ? toolCalls.map((toolCall) => ({
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        args: toolCall.arguments ?? {},
        status: "running",
      }))
    : undefined;
}

export function extractCardFromPartial(
  toolName: string,
  partialResult: unknown,
): ChatCard | undefined {
  if (!isObject(partialResult)) return undefined;
  const details = partialResult.details;
  if (toolName === "render_card" && isRenderCardDetails(details)) {
    return details;
  }
  if (toolName === "generate_image" && isImageCardDetails(details)) {
    return details;
  }
  if (toolName === "run_command" && isCommandCardDetails(details)) {
    return commandCardFromDetails(details);
  }
  return undefined;
}

export function commandCardFromResult(
  result: unknown,
  toolCall: ToolCallInfo,
): CommandCard | undefined {
  const details = isObject(result) ? result.details : undefined;
  if (isRejectedToolDetails(details)) {
    return {
      type: "command",
      status: "error",
      rejected: true,
      command: typeof toolCall.args.command === "string"
        ? toolCall.args.command
        : "",
      cwd: typeof toolCall.args.cwd === "string" ? toolCall.args.cwd : undefined,
      stdout: "",
      stderr: "",
    };
  }
  if (isCommandCardDetails(details)) {
    const card = commandCardFromDetails(details);
    return {
      ...card,
      status: details.status === "error" ? "error" : "completed",
    };
  }
  return undefined;
}

export function buildCardFromToolResult(
  toolName: string,
  toolCall: AgentToolCall,
  details: unknown,
): ChatCard | undefined {
  if (toolName === "render_card" && isRenderCardResultDetails(details)) {
    const card: RenderCardDetails = {
      type: "html",
      html:
        details.html ??
        (details.file_path
          ? undefined
          : getStringArg(toolCall.arguments, "content")),
      file_path: details.file_path,
      title: details.title,
      width: details.width,
      height: details.height ?? 400,
      max_width: details.max_width ?? 800,
      max_height: details.max_height ?? 600,
    };
    return card;
  }
  if (toolName === "generate_image" && isImageCardResultDetails(details)) {
    const card: ImageCardDetails = {
      type: "image",
      status: details.status ?? "done",
      path: details.path,
      prompt: details.prompt ?? "",
      model: details.model,
      mimeType: details.mimeType,
      errorMessage: details.errorMessage,
    };
    return card;
  }
  if (toolName === "run_command") {
    if (isRejectedToolDetails(details)) {
      return {
        type: "command",
        status: "error",
        rejected: true,
        command: getStringArg(toolCall.arguments, "command") ?? "",
        stdout: "",
        stderr: "",
      };
    }
    if (isCommandCardDetails(details)) {
      return {
        ...commandCardFromDetails(details),
        status: details.status === "error" ? "error" : "completed",
      };
    }
  }
  return undefined;
}

function commandCardFromDetails(
  details: Record<string, unknown>,
): CommandCard {
  const status = details.status === "error" ? "error" : "running";
  return {
    type: "command",
    status,
    command: typeof details.command === "string" ? details.command : "",
    cwd: typeof details.cwd === "string" ? details.cwd : undefined,
    stdout: typeof details.stdout === "string" ? details.stdout : "",
    stderr: typeof details.stderr === "string" ? details.stderr : "",
    exitCode:
      typeof details.exitCode === "number" ? details.exitCode : undefined,
    durationMs:
      typeof details.durationMs === "number" ? details.durationMs : undefined,
    timedOut: details.timedOut === true ? true : undefined,
    aborted: details.aborted === true ? true : undefined,
  };
}

function getStringArg(args: unknown, key: string): string | undefined {
  if (!isObject(args)) return undefined;
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
