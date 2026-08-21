import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { NotFoundError } from "../errors.js";
import type { SessionEvent } from "./events.js";
import { EVENT_SCHEMA_VERSION } from "./events.js";
import type { SessionStore } from "../store/session.js";

export interface MigrationResult {
  sessionId: string;
  migrated: boolean;
  eventCount: number;
}

function planLegacyMigration(
  sessionId: string,
  store: SessionStore,
): SessionEvent[] {
  const latest = store.getLatestCompaction(sessionId);
  const rows = store.getSessionMessagesWithIds(sessionId);
  const anchorIndex = latest
    ? rows.findIndex((row) => row.id === latest.anchorMessageId)
    : -1;
  const messages = repairLegacyMessages(
    rows.map((row) => row.message),
    anchorIndex + 1,
  );

  const events: SessionEvent[] = [];
  let seq = 0;

  for (const message of messages) {
    events.push(messageEventOf(message, seq++, message.timestamp));
  }
  if (latest) {
    const anchorSeq = anchorIndex;
    if (anchorSeq >= 0) {
      events.push({
        type: "compaction/applied",
        seq: seq++,
        time: latest.createdAt,
        data: {
          anchorSeq,
          digestContent: latest.digestContent,
          excludedSeqs: [],
        },
      });
    }
  }

  return events;
}

function repairLegacyMessages(
  messages: AgentMessage[],
  activeStartIndex: number,
): AgentMessage[] {
  const answered = new Set<string>();
  let lastAssistant: { toolCalls: Array<{ id: string; name: string }> } | null = null;
  for (const message of messages.slice(activeStartIndex)) {
    if (message.role === "toolResult") {
      answered.add(message.toolCallId);
    } else if (message.role === "assistant") {
      const toolCalls = message.content
        .filter((block) => block.type === "toolCall")
        .map((block) => ({ id: block.id, name: block.name }));
      if (toolCalls.length > 0) lastAssistant = { toolCalls };
    }
  }
  if (!lastAssistant) return messages;

  const now = Date.now();
  const repairs = lastAssistant.toolCalls
    .filter((call) => !answered.has(call.id))
    .map(
      (call): AgentMessage =>
        ({
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: [
            { type: "text", text: "The tool call was interrupted and did not execute." },
          ],
          isError: true,
          timestamp: now,
        }) as AgentMessage,
    );
  return repairs.length > 0 ? [...messages, ...repairs] : messages;
}

function messageEventOf(message: AgentMessage, seq: number, time: number): SessionEvent {
  const role = (message as { role?: string }).role;
  if (role === "assistant") {
    return { type: "assistant/message", seq, time, data: { message: message as never } };
  }
  if (role === "toolResult") {
    return { type: "tool/result", seq, time, data: { message: message as never } };
  }
  return { type: "user/message", seq, time, data: { message } };
}

export function migrateLegacySession(
  store: SessionStore,
  sessionId: string,
): MigrationResult {
  const session = store.getSession(sessionId);
  if (!session) throw new NotFoundError(`Session "${sessionId}" not found`);
  if (!store.sessionNeedsMigration(sessionId)) {
    return { sessionId, migrated: false, eventCount: store.readEvents(sessionId).length };
  }

  const events = planLegacyMigration(sessionId, store);
  store.migrateEvents(sessionId, events, EVENT_SCHEMA_VERSION);
  return { sessionId, migrated: true, eventCount: events.length };
}
