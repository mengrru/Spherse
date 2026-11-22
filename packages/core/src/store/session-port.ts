import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionInfo } from "../types.js";
import type { MessageSearchHit } from "../session/search.js";

export type SessionChangeAction = "created" | "updated" | "deleted";

export interface SessionChangePayload {
  agentId: string;
  sessionId: string;
  action: SessionChangeAction;
}

export interface SessionStorePort {
  close(): void;
  createSession(title?: string, source?: string): string;
  getSession(id: string): SessionInfo | null;
  listSessions(): SessionInfo[];
  listSessionsPage(limit: number, offset: number): { items: SessionInfo[]; hasMore: boolean };
  updateSessionTitle(sessionId: string, title: string): void;
  archiveSession(sessionId: string): void;
  appendEvents(sessionId: string, events: ReadonlyArray<import("../session/events.js").SessionEvent>, schemaVersion: number): void;
  readEvents(sessionId: string): import("../session/events.js").SessionEvent[];
  readEventsAfter(sessionId: string, sinceSeq: number, limit: number): import("../session/events.js").SessionEvent[];
  readEventCount(sessionId: string): number;
  maxSeq(sessionId: string): number | null;
  searchMessages(query: string, prefetchLimit: number): MessageSearchHit[];
  migrateEvents(sessionId: string, events: ReadonlyArray<import("../session/events.js").SessionEvent>, schemaVersion: number): void;
  isMigrated(sessionId: string): boolean;
  sessionNeedsMigration(sessionId: string): boolean;
  getSessionMessages(sessionId: string): AgentMessage[];
  getSessionMessagesWithIds(sessionId: string): SessionMessageEntry[];
  getMessagesAfter(sessionId: string, anchorId: number): SessionMessageEntry[];
  getLatestCompaction(
    sessionId: string,
  ): {
    id: number;
    anchorMessageId: number;
    digestContent: string;
    tokenEstimate: number;
    createdAt: number;
  } | null;
  getRecentMessages(
    sessionId: string,
    limit: number,
    beforeId?: number,
  ): {
    messages: AgentMessage[];
    entries: SessionMessageEntry[];
    hasMore: boolean;
    oldestId: number | null;
  };
}

export interface SessionMessageEntry {
  id: number;
  message: AgentMessage;
}

export const CURRENT_MESSAGE_CONTENT_VERSION = 1;

const KNOWN_MESSAGE_ROLES = new Set([
  "user",
  "assistant",
  "toolResult",
  "bashExecution",
  "custom",
  "branchSummary",
  "compactionSummary",
]);

export function isAgentMessage(v: unknown): v is AgentMessage {
  if (typeof v !== "object" || v === null) return false;
  const role = (v as { role?: unknown }).role;
  return typeof role === "string" && KNOWN_MESSAGE_ROLES.has(role);
}

export function parseAgentMessageContent(content: string, rowId: number, schemaVersion: number): AgentMessage {
  const parsed: unknown = JSON.parse(content);
  const adapted =
    schemaVersion === CURRENT_MESSAGE_CONTENT_VERSION
      ? parsed
      : adaptMessageContent(parsed, schemaVersion);
  if (!isAgentMessage(adapted)) {
    throw new Error(
      `Corrupt message at messages.id=${rowId} (schema_version=${schemaVersion}): expected {role, ...} got ${JSON.stringify(parsed).slice(0, 200)}`,
    );
  }
  return adapted;
}

function adaptMessageContent(parsed: unknown, fromVersion: number): unknown {
  if (fromVersion > CURRENT_MESSAGE_CONTENT_VERSION) {
    throw new Error(
      `Cannot read message with schema_version=${fromVersion}; current code supports up to ${CURRENT_MESSAGE_CONTENT_VERSION}. Please upgrade the app.`,
    );
  }
  return parsed;
}
