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

function projection(entries: ChatEntry[]): string[] {
  return entries.map((entry) => {
    const seq = entry.seq ?? entry.id;
    if (entry.kind === "assistant") return `assistant#${seq}:${entry.text}`;
    if (entry.kind === "user") return `user#${seq}:${entry.text}`;
    return `${entry.kind}#${seq}`;
  });
}

interface GeneratedLog {
  events: ChatReplayEvent[];
  messages: Array<{ type: "user" | "assistant"; seq: number; text: string; messageId?: string }>;
  abandoned: Set<number>;
  withdrawn: Array<[number, number]>;
}

function generateLog(random: () => number): GeneratedLog {
  const events: ChatReplayEvent[] = [];
  const messages: GeneratedLog["messages"] = [];
  const abandoned = new Set<number>();
  const withdrawn: Array<[number, number]> = [];
  let seq = 0;
  const turns = 1 + Math.floor(random() * 4);
  for (let turn = 0; turn < turns; turn++) {
    const userSeq = seq++;
    events.push(replayEvent({
      type: "user/message",
      seq: userSeq,
      time: userSeq,
      data: { message: { role: "user", content: `q${userSeq}`, timestamp: userSeq } },
    }));
    messages.push({ type: "user", seq: userSeq, text: `q${userSeq}` });

    const assistantSeq = seq++;
    events.push(replayEvent({
      type: "assistant/message",
      seq: assistantSeq,
      time: assistantSeq,
      data: { message: { role: "assistant", content: `a${assistantSeq}`, timestamp: assistantSeq } },
    }));
    messages.push({ type: "assistant", seq: assistantSeq, text: `a${assistantSeq}`, messageId: `m${assistantSeq}` });

    const roll = random();
    if (roll < 0.25) {
      events.push(replayEvent({
        type: "turn/retried",
        seq: seq,
        time: seq,
        data: { abandonedSeqs: [assistantSeq] },
      }));
      abandoned.add(assistantSeq);
      seq += 1;
      const retriedSeq = seq++;
      events.push(replayEvent({
        type: "assistant/message",
        seq: retriedSeq,
        time: retriedSeq,
        data: { message: { role: "assistant", content: `r${retriedSeq}`, timestamp: retriedSeq } },
      }));
      messages.push({ type: "assistant", seq: retriedSeq, text: `r${retriedSeq}`, messageId: `m${retriedSeq}` });
    } else if (roll < 0.4) {
      const end = seq;
      events.push(replayEvent({
        type: "turn/withdrawn",
        seq: end,
        time: end,
        data: { seq: userSeq },
      }));
      seq += 1;
      withdrawn.push([userSeq, end]);
    }
  }
  return { events, messages, abandoned, withdrawn };
}

function isRemoved(log: GeneratedLog, seq: number): boolean {
  if (log.abandoned.has(seq)) return true;
  return log.withdrawn.some(([from, to]) => seq >= from && seq < to);
}

function expectedProjection(log: GeneratedLog): string[] {
  return log.messages
    .filter((message) => !isRemoved(log, message.seq))
    .map((message) => `${message.type}#${message.seq}:${message.text}`);
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
      const log = generateLog(random);
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
      const log = generateLog(random);
      if (log.withdrawn.length > 0) continue;
      const replayed = applyPersistedEvents(createEntryState(), log.events, iteration);

      const wire: AgentEvent[] = [];
      for (const message of log.messages) {
        if (message.type === "user") {
          wire.push(event({
            type: "user_message",
            seq: message.seq,
            message: { role: "user", content: message.text, timestamp: message.seq },
          }));
          continue;
        }
        wire.push(event({
          type: "message_start",
          message: { role: "assistant", content: "", timestamp: message.seq },
          messageId: message.messageId,
        }));
        wire.push(event({
          type: "message_update",
          message: { role: "assistant", content: message.text, timestamp: message.seq },
          messageId: message.messageId,
        }));
        wire.push(event({
          type: "message_end",
          message: { role: "assistant", content: message.text, timestamp: message.seq },
          messageId: message.messageId,
          seq: message.seq,
        }));
      }
      for (const item of log.events) {
        if (item.type === "turn/retried") {
          wire.push(event({ type: "turn_retried", seq: item.seq, abandonedSeqs: item.data.abandonedSeqs }));
        }
      }
      const live = reduceLiveEvents(createEntryState(), wire, iteration);

      expect(projection(live.entries)).toEqual(projection(replayed.entries));
      expect(live.cursor).toBe(replayed.cursor);
    }
  });

  it("never keeps entries inside withdrawn or abandoned seq ranges", () => {
    const random = makeRandom(23);
    for (let iteration = 0; iteration < 200; iteration++) {
      const log = generateLog(random);
      const state = applyPersistedEvents(createEntryState(), log.events, iteration);
      for (const entry of state.entries) {
        if (entry.seq === undefined) continue;
        expect(isRemoved(log, entry.seq)).toBe(false);
      }
      expect(state.cursor).toBe(log.events[log.events.length - 1].seq);
    }
  });

  it("is idempotent when the full log is applied twice", () => {
    const random = makeRandom(31);
    for (let iteration = 0; iteration < 100; iteration++) {
      const log = generateLog(random);
      const once = applyPersistedEvents(createEntryState(), log.events, iteration);
      const twice = applyPersistedEvents(once, log.events, iteration);
      expect(twice).toStrictEqual(once);
    }
  });
});
