import type {
  AssistantMessage,
  Message,
  RenderCardDetails,
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
import type {
  ChatCard,
  CommandCard,
  InteractionState,
  ToolCallInfo,
} from "../types";

export interface ToolCallLifecycle {
  partialDetails?: unknown;
  resultDetails?: unknown;
  isError?: boolean;
  interaction?: InteractionState;
}

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

export function extractEventDetails(payload: unknown): unknown {
  return isObject(payload) ? payload.details : undefined;
}

export function projectChatCard(
  toolName: string,
  args: Record<string, unknown>,
  lifecycle: ToolCallLifecycle,
): ChatCard | undefined {
  const card = projectFromResultDetails(toolName, args, lifecycle.resultDetails);
  if (card) return card;
  const interactionCard = projectFromInteraction(toolName, args, lifecycle);
  if (interactionCard) return interactionCard;
  return projectFromPartialDetails(toolName, lifecycle.partialDetails);
}

function projectFromResultDetails(
  toolName: string,
  args: Record<string, unknown>,
  details: unknown,
): ChatCard | undefined {
  if (details === undefined) return undefined;
  if (toolName === "render_card" && isRenderCardResultDetails(details)) {
    const card: RenderCardDetails = {
      type: "html",
      html:
        details.html ??
        (details.file_path
          ? undefined
          : getStringArg(args, "content")),
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
    return {
      type: "image",
      status: details.status ?? "done",
      path: details.path,
      prompt: details.prompt ?? "",
      model: details.model,
      mimeType: details.mimeType,
      errorMessage: details.errorMessage,
    };
  }
  if (toolName === "run_command") {
    if (isRejectedToolDetails(details)) {
      return commandCardFromArgs(args, {
        status: "error",
        rejected: true,
      });
    }
    if (isCommandCardDetails(details)) {
      return {
        ...commandCardFromDetails(details),
        status: details.status === "error" ? "error" : "completed",
      };
    }
  }
  if (toolName === "ask_user" && isObject(details) && details.cardType === "question") {
    const question = typeof details.question === "string" ? details.question : "";
    const rawOptions = Array.isArray(details.options)
      ? details.options.filter((o): o is string => typeof o === "string")
      : [];
    const options = rawOptions.length > 0 ? rawOptions : undefined;
    if (typeof details.answer === "string") {
      return { type: "question", status: "answered", question, options, answer: details.answer };
    }
    if (details.timedOut === true) {
      return { type: "question", status: "timeout", question, options };
    }
  }
  return undefined;
}

function projectFromInteraction(
  toolName: string,
  args: Record<string, unknown>,
  lifecycle: ToolCallLifecycle,
): ChatCard | undefined {
  const interaction = lifecycle.interaction;
  if (!interaction) return undefined;
  const requestId =
    interaction.status.type === "pending" ? interaction.requestId : undefined;

  if (interaction.kind === "question") {
    return {
      type: "question",
      status: questionStatusFromInteraction(interaction),
      question: typeof args.question === "string" ? args.question : "",
      options: questionOptionsFromArgs(args),
      ...(interaction.status.type === "answered"
        ? { answer: interaction.status.answer }
        : {}),
      ...(requestId !== undefined ? { requestId } : {}),
    };
  }

  if (toolName === "run_command") {
    const base = commandCardFromDetailsPartial(lifecycle.partialDetails, args);
    if (interaction.status.type === "pending") {
      return { ...base, status: "pending_approval", requestId: interaction.requestId };
    }
    if (interaction.status.type === "rejected") {
      return { ...base, status: "error", rejected: true };
    }
    return { ...base, status: "running" };
  }

  return {
    type: "approval",
    status:
      interaction.status.type === "approved"
        ? "approved"
        : interaction.status.type === "rejected"
          ? "rejected"
          : "pending",
    toolName,
    args,
    ...(requestId !== undefined ? { requestId } : {}),
  };
}

function projectFromPartialDetails(
  toolName: string,
  partialDetails: unknown,
): ChatCard | undefined {
  if (partialDetails === undefined) return undefined;
  if (toolName === "render_card" && isRenderCardDetails(partialDetails)) {
    return partialDetails;
  }
  if (toolName === "generate_image" && isImageCardDetails(partialDetails)) {
    return partialDetails;
  }
  if (toolName === "run_command" && isCommandCardDetails(partialDetails)) {
    return commandCardFromDetails(partialDetails);
  }
  return undefined;
}

function questionStatusFromInteraction(
  interaction: InteractionState,
): "pending" | "answered" | "timeout" {
  if (interaction.status.type === "answered") return "answered";
  if (interaction.status.type === "timeout") return "timeout";
  return "pending";
}

function questionOptionsFromArgs(
  args: Record<string, unknown>,
): string[] | undefined {
  const filtered = Array.isArray(args.options)
    ? args.options.filter((s): s is string => typeof s === "string")
    : undefined;
  return filtered && filtered.length >= 2 ? filtered : undefined;
}

function commandCardFromArgs(
  args: Record<string, unknown>,
  extra: { status: CommandCard["status"]; rejected?: boolean },
): CommandCard {
  return {
    type: "command",
    status: extra.status,
    ...(extra.rejected !== undefined ? { rejected: extra.rejected } : {}),
    command: getStringArg(args, "command") ?? "",
    cwd: getStringArg(args, "cwd"),
    stdout: "",
    stderr: "",
  };
}

function commandCardFromDetailsPartial(
  partialDetails: unknown,
  args: Record<string, unknown>,
): CommandCard {
  if (isCommandCardDetails(partialDetails)) {
    return commandCardFromDetails(partialDetails);
  }
  return commandCardFromArgs(args, { status: "running" });
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
