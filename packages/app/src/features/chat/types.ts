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
  partialDetails?: unknown;
  resultDetails?: unknown;
  isError?: boolean;
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
  _toolCalls?: ToolCallInfo[];
  _error?: string;
  _errorCode?: ErrorEventCode;
  _turnError?: boolean;
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

export interface RenderItem {
  key: string;
  message: ChatMessage;
  streaming?: boolean;
  sendFailed?: boolean;
  withdrawError?: boolean;
}

export interface HistoryState {
  messages: ChatMessage[];
  hasMore: boolean;
  oldestLoadedId: number | null;
  historyStatus: "pending" | "syncing" | "ready";
  historyError: boolean;
}

export interface SegmentError {
  message: string;
  code?: ErrorEventCode;
  turnError: boolean;
}

export interface AssistantSegment {
  content: string;
  toolCalls: ToolCallInfo[];
  finished: boolean;
  error?: SegmentError;
  timestamp?: number;
}

export interface RunState {
  id: number;
  active: boolean;
  segments: AssistantSegment[];
}

export interface OutboxEntry {
  id: string;
  seq: number;
  content: string;
  attachments?: ChatAttachment[];
  timestamp: number;
  status: "pending" | "sent" | "failed";
  sentAfterMessageId: number | null;
}

export type InteractionStatus =
  | { type: "pending" }
  | { type: "approved" }
  | { type: "rejected" }
  | { type: "answered"; answer: string }
  | { type: "timeout" };

export interface InteractionState {
  kind: "approval" | "question";
  requestId: string;
  toolCallId: string;
  toolName: string;
  status: InteractionStatus;
}

export interface ChatSessionData {
  history: HistoryState;
  runs: RunState[];
  outbox: OutboxEntry[];
  interactions: Record<string, InteractionState>;
  seq: number;
  pendingWithdraw: boolean;
  retrying: boolean;
  withdrawError: boolean;
  lastActivityAt: number;
  scrollPosition: number;
}

export function isSessionStreaming(session: ChatSessionData): boolean {
  return (
    session.outbox.some((entry) => entry.status === "pending") ||
    session.runs.some((run) => run.active) ||
    session.retrying
  );
}
