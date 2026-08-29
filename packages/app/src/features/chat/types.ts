import type { ErrorEventCode } from "@spherse/contracts";

export interface HtmlCard {
  type: "html";
  html?: string;
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

export interface CommandCard {
  type: "command";
  status: "pending_approval" | "running" | "completed" | "error";
  command: string;
  cwd?: string;
  stdout: string;
  stderr: string;
  exitCode?: number;
  durationMs?: number;
  timedOut?: boolean;
  aborted?: boolean;
  rejected?: boolean;
  requestId?: string;
}

export interface ApprovalCard {
  type: "approval";
  status: "pending" | "approved" | "rejected";
  toolName: string;
  args: Record<string, unknown>;
  requestId?: string;
}

export interface QuestionCard {
  type: "question";
  status: "pending" | "answered" | "timeout";
  question: string;
  options?: string[];
  answer?: string;
  requestId?: string;
}

export type ChatCard = HtmlCard | ImageCard | CommandCard | ApprovalCard | QuestionCard;

export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  partialResult?: string;
  status: "running" | "completed" | "error";
  _card?: ChatCard;
}

export interface ChatAttachment {
  type: "image";
  path: string;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface AttachedImage {
  path: string;
  mimeType: string;
  width?: number;
  height?: number;
  previewUrl: string;
}

export interface SendableImage {
  path: string;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  _messageId?: number;
  _optimistic?: boolean;
  _streaming?: boolean;
  _toolCalls?: ToolCallInfo[];
  _error?: string;
  _errorCode?: ErrorEventCode;
  _turnError?: boolean;
  _withdrawError?: boolean;
  _sendFailed?: boolean;
  _runChanges?: FileChangeCard[];
  _attachments?: ChatAttachment[];
  _triggered?: true;
  _triggerName?: string;
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
