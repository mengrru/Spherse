export interface HtmlCard {
  type: "html";
  html: string;
  title?: string;
  width?: number;
  height?: number;
  max_width?: number;
  max_height?: number;
}

export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  partialResult?: string;
  status: "running" | "completed" | "error";
  _card?: HtmlCard;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  _streaming?: boolean;
  _toolCalls?: ToolCallInfo[];
  _error?: string;
  _runChanges?: FileChangeCard[];
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
