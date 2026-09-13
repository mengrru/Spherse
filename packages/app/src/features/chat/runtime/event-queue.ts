import type { AgentEvent } from "../model/agent-event-parse";

export type EventBatches = Map<string, AgentEvent[]>;

export type ScheduleFlush = (callback: () => void) => () => void;

export interface EventQueue {
  push(sessionId: string, event: AgentEvent): void;
  pushBatch(sessionId: string, events: AgentEvent[]): void;
  cancel(sessionId?: string): void;
  flushNow(): void;
}

const FALLBACK_FLUSH_MS = 200;

export const scheduleWithRaf: ScheduleFlush = (callback) => {
  let finished = false;
  const run = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(handle);
    clearTimeout(timer);
    callback();
  };
  const handle = requestAnimationFrame(run);
  const timer = setTimeout(run, FALLBACK_FLUSH_MS);
  return () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(handle);
    clearTimeout(timer);
  };
};

export function createEventQueue(
  flush: (batches: EventBatches) => void,
  schedule: ScheduleFlush = scheduleWithRaf,
): EventQueue {
  const queues = new Map<string, AgentEvent[]>();
  let cancelScheduled: (() => void) | null = null;

  const drain = () => {
    cancelScheduled = null;
    if (queues.size === 0) return;
    const batches = new Map(queues);
    queues.clear();
    flush(batches);
  };

  return {
    push(sessionId, event) {
      const queue = queues.get(sessionId);
      if (queue) queue.push(event);
      else queues.set(sessionId, [event]);
      if (!cancelScheduled) cancelScheduled = schedule(drain);
    },

    pushBatch(sessionId, events) {
      if (events.length === 0) return;
      const queue = queues.get(sessionId);
      if (queue) queue.push(...events);
      else queues.set(sessionId, [...events]);
      if (!cancelScheduled) cancelScheduled = schedule(drain);
    },

    cancel(sessionId) {
      if (sessionId === undefined) {
        queues.clear();
        cancelScheduled?.();
        cancelScheduled = null;
        return;
      }
      queues.delete(sessionId);
    },

    flushNow() {
      cancelScheduled?.();
      cancelScheduled = null;
      drain();
    },
  };
}
