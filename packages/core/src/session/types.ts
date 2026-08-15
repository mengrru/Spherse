import type { ProjectStore } from "../store/project.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import type { TriggerManager } from "../trigger/trigger-manager.js";
import type { McpConnectionManager } from "../mcp/mcp-connection-manager.js";
import type { Logger } from "../logger.js";
import type { SamplingParams } from "../types.js";

export interface SessionContext {
  projectStore: ProjectStore;
  projectRoot: string;
  fileWriteMutex: FileWriteMutex;
  logger: Logger;
  defaultModel?: string;
  sampling?: SamplingParams;
  triggerManager?: TriggerManager;
  mcpConnectionManager: McpConnectionManager;
}

export interface TurnContextSnapshot {
  sessionId: string;
  capturedAt: string;
  systemPrompt: string;
  messages: unknown[];
  tools: Array<{
    name: string;
    description: string;
    parameters: unknown;
  }>;
}

export type ControlRequestKind = "approval" | "question";

export type SessionControlEvent =
  | {
      type: "control_request";
      requestId: string;
      kind: "approval";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "control_resolved";
      requestId: string;
      kind: "approval";
      approved: boolean;
      reason?: string;
    }
  | {
      type: "control_request";
      requestId: string;
      kind: "question";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "control_resolved";
      requestId: string;
      kind: "question";
      answer?: string;
      timedOut: boolean;
    };
