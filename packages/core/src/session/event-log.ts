import type { SessionEvent, SessionEventType, SessionEventMap } from "./events.js";
import { EVENT_SCHEMA_VERSION } from "./events.js";
import type { SessionStore } from "../store/session.js";

export interface SessionEventWriter {
  append<T extends SessionEventType>(type: T, data: SessionEventMap[T]): SessionEvent;
  readonly events: readonly SessionEvent[];
}

type Listener = (event: SessionEvent) => void;

export class SessionEventLog implements SessionEventWriter {
  private readonly entries: SessionEvent[] = [];
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly store: SessionStore,
    private readonly sessionId: string,
  ) {}

  append<T extends SessionEventType>(type: T, data: SessionEventMap[T]): SessionEvent {
    return this.appendBatch([{ type, data }])[0];
  }

  appendBatch(
    items: ReadonlyArray<{
      type: SessionEventType;
      data: SessionEventMap[SessionEventType];
    }>,
  ): SessionEvent[] {
    if (items.length === 0) return [];
    let seq = this.entries.length > 0 ? this.entries[this.entries.length - 1].seq + 1 : 0;
    const time = Date.now();
    const events = items.map(
      (item): SessionEvent =>
        ({
          type: item.type,
          seq: seq++,
          time,
          data: item.data,
        }) as SessionEvent,
    );
    this.entries.push(...events);
    try {
      this.store.appendEvents(this.sessionId, events, EVENT_SCHEMA_VERSION);
    } catch (error) {
      this.entries.splice(this.entries.length - events.length, events.length);
      throw error;
    }
    for (const event of events) {
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch {
          // notification failures must not affect the committed fact
        }
      }
    }
    return events;
  }

  get events(): readonly SessionEvent[] {
    return this.entries;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  static open(store: SessionStore, sessionId: string): SessionEventLog {
    const log = new SessionEventLog(store, sessionId);
    const existing = store.readEvents(sessionId);
    if (existing.some((event, index) => event.seq !== index)) {
      throw new Error(
        `Corrupt event log for session ${sessionId}: seq gap or non-contiguous sequence`,
      );
    }
    log.entries.push(...existing);
    return log;
  }
}
