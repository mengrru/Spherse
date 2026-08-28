import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { wrapDigestContent } from "../context/compaction.js";
import { MESSAGE_EVENT_TYPES, type SessionEvent } from "./events.js";

export interface DerivedMessageEntry {
  seq: number;
  message: AgentMessage;
  source?: "triggered";
  triggerName?: string;
}

interface RestartState {
  compaction?: {
    anchorSeq: number;
    digestContent: string;
    eventSeq: number;
    excludedSeqs: Set<number>;
  };
  abandonedSeqs: Set<number>;
}

export function deriveMessages(events: readonly SessionEvent[]): AgentMessage[] {
  return deriveMessageEntries(events).map((entry) => entry.message);
}

export function deriveHistoryEntries(
  events: readonly SessionEvent[],
): DerivedMessageEntry[] {
  const abandonedSeqs = collectAbandonedSeqs(events);
  const entries: DerivedMessageEntry[] = [];
  for (const event of events) {
    if (!MESSAGE_EVENT_TYPES.has(event.type) || abandonedSeqs.has(event.seq)) continue;
    entries.push(projectMessageEvent(event));
  }
  return entries;
}

export function deriveMessageEntries(
  events: readonly SessionEvent[],
): DerivedMessageEntry[] {
  const restart = scanRestarts(events);
  const entries: DerivedMessageEntry[] = [];

  if (restart.compaction) {
    entries.push({
      seq: restart.compaction.eventSeq,
      message: {
        role: "user",
        content: wrapDigestContent(restart.compaction.digestContent),
        timestamp: 0,
      } as unknown as AgentMessage,
    });
  }

  for (const event of events) {
    if (!MESSAGE_EVENT_TYPES.has(event.type)) continue;
    if (restart.compaction && event.seq <= restart.compaction.anchorSeq) continue;
    if (restart.compaction?.excludedSeqs.has(event.seq)) continue;
    if (restart.abandonedSeqs.has(event.seq)) continue;
    entries.push(projectMessageEvent(event));
  }
  return entries;
}

function projectMessageEvent(event: SessionEvent): DerivedMessageEntry {
  const data = event.data as {
    message: AgentMessage;
    source?: "triggered";
    triggerName?: string;
  };
  return {
    seq: event.seq,
    message: data.message,
    ...(data.source !== undefined ? { source: data.source } : {}),
    ...(data.triggerName !== undefined ? { triggerName: data.triggerName } : {}),
  };
}

function scanRestarts(events: readonly SessionEvent[]): RestartState {
  const state: RestartState = { abandonedSeqs: collectAbandonedSeqs(events) };
  for (const event of events) {
    if (event.type === "compaction/applied") {
      state.compaction = {
        anchorSeq: event.data.anchorSeq,
        digestContent: event.data.digestContent,
        eventSeq: event.seq,
        excludedSeqs: new Set(event.data.excludedSeqs ?? []),
      };
    }
  }
  return state;
}

export function collectAbandonedSeqs(events: readonly SessionEvent[]): Set<number> {
  const abandoned = new Set<number>();
  for (const event of events) {
    if (event.type === "turn/retried") {
      for (const seq of event.data.abandonedSeqs) abandoned.add(seq);
    } else if (event.type === "turn/withdrawn") {
      for (let seq = event.data.seq; seq < event.seq; seq++) abandoned.add(seq);
    }
  }
  return abandoned;
}

const INTERRUPTED_TOOL_TEXT = "The tool call was interrupted and did not execute.";

export function repairLog(events: readonly SessionEvent[]): SessionEvent[] {
  let hasOpenTurn = false;
  let openTurnStartIndex = -1;
  for (const [index, event] of events.entries()) {
    if (event.type === "turn/start") {
      hasOpenTurn = true;
      openTurnStartIndex = index;
    } else if (event.type === "turn/end") {
      hasOpenTurn = false;
      openTurnStartIndex = -1;
    }
  }
  if (!hasOpenTurn) return [];

  const answered = new Set<string>();
  let lastToolCallAssistant: {
    toolCalls: Array<{ id: string; name: string }>;
  } | null = null;
  for (const event of events.slice(openTurnStartIndex + 1)) {
    if (event.type === "tool/result") {
      answered.add(event.data.message.toolCallId);
    } else if (event.type === "assistant/message") {
      const toolCalls = event.data.message.content
        .filter((block) => block.type === "toolCall")
        .map((block) => ({ id: block.id, name: block.name }));
      if (toolCalls.length > 0) lastToolCallAssistant = { toolCalls };
    }
  }

  const repairs: SessionEvent[] = [];
  let nextSeq = events.length > 0 ? events[events.length - 1].seq + 1 : 0;
  const now = Date.now();
  if (lastToolCallAssistant) {
    for (const toolCall of lastToolCallAssistant.toolCalls) {
      if (answered.has(toolCall.id)) continue;
      repairs.push({
        type: "tool/result",
        seq: nextSeq++,
        time: now,
        data: {
          message: {
            role: "toolResult",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: [{ type: "text", text: INTERRUPTED_TOOL_TEXT }],
            isError: true,
            timestamp: now,
          } as unknown as ToolResultMessage,
        },
      });
    }
  }
  repairs.push({
    type: "turn/end",
    seq: nextSeq++,
    time: now,
    data: { reason: "aborted" },
  });
  return repairs;
}
