import { describe, expect, it } from "vitest";
import type { ChatReplayEvent } from "@spherse/contracts";
import { createEntryState, applyPersistedEvents, reduceLiveEvents } from "./entry-reducer";
import type { AgentEvent } from "./agent-event-parse";
import type { ChatEntry } from "./entry";

function replayEvent(payload: object): ChatReplayEvent {
  return payload as unknown as ChatReplayEvent;
}

function event(payload: object): AgentEvent {
  return payload as unknown as AgentEvent;
}

function messageText(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Array<{ type: string; text?: string }>)
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

function projection(entries: ChatEntry[]): string[] {
  return entries.map((entry) => {
    const seq = entry.seq ?? entry.id;
    if (entry.kind === "assistant") return `assistant#${seq}:${entry.text}`;
    if (entry.kind === "user") return `user#${seq}:${entry.text}`;
    return `${entry.kind}#${seq}`;
  });
}

interface GenerateOptions {
  tools: boolean;
  compaction: boolean;
}

interface GeneratedLog {
  events: ChatReplayEvent[];
  wire: AgentEvent[];
  abandoned: Set<number>;
  withdrawn: Array<[number, number]>;
}

function generateLog(random: () => number, options: GenerateOptions): GeneratedLog {
  const events: ChatReplayEvent[] = [];
  const wire: AgentEvent[] = [];
  const abandoned = new Set<number>();
  const withdrawn: Array<[number, number]> = [];
  let seq = 0;
  const turns = 1 + Math.floor(random() * 4);

  const pushAssistant = (text: string, messageCounter: { value: number }): { assistantSeq: number; toolSeq?: number } => {
    const assistantSeq = seq++;
    const messageId = `m${(messageCounter.value += 1)}`;
    const toolCallId = `tc${assistantSeq}`;
    const useTool = options.tools && random() < 0.5;
    const content: Array<Record<string, unknown>> = [{ type: "text", text }];
    if (useTool) {
      content.push({ type: "toolCall", id: toolCallId, name: "read_file", arguments: { path: "a" } });
    }
    events.push(replayEvent({
      type: "assistant/message",
      seq: assistantSeq,
      time: assistantSeq,
      data: { message: { role: "assistant", content, timestamp: assistantSeq } },
    }));
    wire.push(
      event({ type: "message_start", message: { role: "assistant", content: [], timestamp: assistantSeq }, messageId }),
      event({ type: "message_update", message: { role: "assistant", content, timestamp: assistantSeq }, messageId }),
      event({ type: "message_end", message: { role: "assistant", content, timestamp: assistantSeq }, messageId, seq: assistantSeq }),
    );
    if (!useTool) return { assistantSeq };
    const toolSeq = seq++;
    events.push(replayEvent({
      type: "tool/result",
      seq: toolSeq,
      time: toolSeq,
      data: {
        message: {
          role: "toolResult",
          toolCallId,
          content: [{ type: "text", text: `tr${toolSeq}` }],
          isError: false,
          timestamp: toolSeq,
        },
      },
    }));
    return { assistantSeq, toolSeq };
  };

  for (let turn = 0; turn < turns; turn++) {
    wire.push(event({ type: "agent_start" }));
    const userSeq = seq++;
    events.push(replayEvent({
      type: "user/message",
      seq: userSeq,
      time: userSeq,
      data: { message: { role: "user", content: `q${userSeq}`, timestamp: userSeq } },
    }));
    wire.push(event({
      type: "user_message",
      seq: userSeq,
      message: { role: "user", content: `q${userSeq}`, timestamp: userSeq },
    }));

    const messageCounter = { value: 0 };
    const first = pushAssistant(`a${seq}`, messageCounter);
    const roll = random();
    if (roll < 0.25) {
      const abandonedSeqs = [first.assistantSeq, ...(first.toolSeq !== undefined ? [first.toolSeq] : [])];
      events.push(replayEvent({ type: "turn/retried", seq: seq, time: seq, data: { abandonedSeqs } }));
      wire.push(event({ type: "agent_start" }));
      wire.push(event({ type: "turn_retried", seq, abandonedSeqs }));
      for (const abandonedSeq of abandonedSeqs) abandoned.add(abandonedSeq);
      seq += 1;
      messageCounter.value = 0;
      pushAssistant(`r${seq}`, messageCounter);
    } else if (roll < 0.4) {
      const end = seq;
      events.push(replayEvent({ type: "turn/withdrawn", seq: end, time: end, data: { seq: userSeq } }));
      wire.push(event({ type: "turn_withdrawn", seq: userSeq }));
      seq += 1;
      withdrawn.push([userSeq, end]);
      break;
    }
    if (options.compaction && random() < 0.2) {
      events.push(replayEvent({
        type: "compaction/applied",
        seq,
        time: seq,
        data: { anchorSeq: first.assistantSeq, digestContent: "digest", excludedSeqs: [] },
      }));
      seq += 1;
    }
  }
  return { events, wire, abandoned, withdrawn };
}

function expectedProjection(log: GeneratedLog): string[] {
  const isRemoved = (seq: number): boolean =>
    log.abandoned.has(seq) || log.withdrawn.some(([from, to]) => seq >= from && seq < to);
  const expected: string[] = [];
  for (const item of log.events) {
    if (isRemoved(item.seq)) continue;
    if (item.type === "user/message") expected.push(`user#${item.seq}:${messageText(item.data.message)}`);
    else if (item.type === "assistant/message") expected.push(`assistant#${item.seq}:${messageText(item.data.message)}`);
    else if (item.type === "tool/result") expected.push(`tool-result#${item.seq}`);
  }
  return expected;
}

function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("entry reducer protocol v2 properties", () => {
  it("chunked replay with duplicate batches equals full-log replay", () => {
    const random = makeRandom(7);
    for (let iteration = 0; iteration < 200; iteration++) {
      const log = generateLog(random, { tools: true, compaction: true });
      const full = applyPersistedEvents(createEntryState(), log.events, iteration);
      const expected = expectedProjection(log);

      let chunked = createEntryState();
      let index = 0;
      while (index < log.events.length) {
        const size = 1 + Math.floor(random() * 4);
        const batch = log.events.slice(index, index + size);
        chunked = applyPersistedEvents(chunked, batch, iteration);
        if (random() < 0.3) chunked = applyPersistedEvents(chunked, batch, iteration);
        index += size;
      }

      expect(projection(full.entries)).toEqual(expected);
      expect(projection(chunked.entries)).toEqual(expected);
      expect(chunked.cursor).toBe(full.cursor);
      expect(chunked.entries).toHaveLength(full.entries.length);
    }
  });

  it("live wire events and replay produce the same projection", () => {
    const random = makeRandom(11);
    for (let iteration = 0; iteration < 200; iteration++) {
      const log = generateLog(random, { tools: false, compaction: false });
      const replayed = applyPersistedEvents(createEntryState(), log.events, iteration);
      const live = reduceLiveEvents(createEntryState(), log.wire, iteration);

      expect(projection(live.entries)).toEqual(projection(replayed.entries));
      expect(live.entries).toHaveLength(replayed.entries.length);
      if (log.withdrawn.length === 0) {
        expect(live.cursor).toBe(replayed.cursor);
      }
    }
  });

  it("never keeps entries inside withdrawn or abandoned seq ranges", () => {
    const random = makeRandom(23);
    for (let iteration = 0; iteration < 200; iteration++) {
      const log = generateLog(random, { tools: true, compaction: true });
      const state = applyPersistedEvents(createEntryState(), log.events, iteration);
      const isRemoved = (seq: number): boolean =>
        log.abandoned.has(seq) || log.withdrawn.some(([from, to]) => seq >= from && seq < to);
      for (const entry of state.entries) {
        if (entry.seq !== undefined) expect(isRemoved(entry.seq)).toBe(false);
      }
      for (const entry of state.entries) {
        if (entry.kind !== "tool-result") continue;
        expect(entry.ownerId).toBeDefined();
      }
      expect(state.cursor).toBe(log.events[log.events.length - 1].seq);
    }
  });

  it("keeps compacted entries visible and only advances the cursor", () => {
    const random = makeRandom(29);
    let sawCompaction = false;
    for (let iteration = 0; iteration < 200; iteration++) {
      const log = generateLog(random, { tools: true, compaction: true });
      if (log.events.some((item) => item.type === "compaction/applied")) sawCompaction = true;
      const state = applyPersistedEvents(createEntryState(), log.events, iteration);
      expect(projection(state.entries)).toEqual(expectedProjection(log));
      expect(state.cursor).toBe(log.events[log.events.length - 1].seq);
    }
    expect(sawCompaction).toBe(true);
  });

  it("is idempotent when the full log is applied twice", () => {
    const random = makeRandom(31);
    for (let iteration = 0; iteration < 100; iteration++) {
      const log = generateLog(random, { tools: true, compaction: true });
      const once = applyPersistedEvents(createEntryState(), log.events, iteration);
      const twice = applyPersistedEvents(once, log.events, iteration);
      expect(twice).toStrictEqual(once);
    }
  });
});
