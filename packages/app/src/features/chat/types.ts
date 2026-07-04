import type { ErrorEventCode } from "@spherse/server/contracts";

export interface HtmlCard {
  type: "html";
  html: string;
  file_path?: string;
  title?: string;
  width?: number;
  height?: number;
  max_width?: number;
  max_height?: number;
}

export interface ImageCard {
  type: "image";
  status: "generating" | "done" | "error";
  path?: string;
  prompt: string;
  model?: string;
  mimeType?: string;
  errorMessage?: string;
}

export type ChatCard = HtmlCard | ImageCard;

export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  partialResult?: string;
  status: "running" | "completed" | "error";
  _card?: ChatCard;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  _streaming?: boolean;
  _toolCalls?: ToolCallInfo[];
  _error?: string;
  _errorCode?: ErrorEventCode;
  _runChanges?: FileChangeCard[];
  timestamp?: number;
}

export interface FileChangeOp {
  toolCallId: string;
  toolName: "write_file" | "edit_file";
  args: Record<string, unknown>;
}

export interface FileChangeCard {
  path: string;
  ops: FileChangeOp[];
}
