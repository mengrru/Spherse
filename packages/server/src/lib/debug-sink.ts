import { Writable } from "node:stream";

export type DebugSubscriber = (envelopeJson: string) => void;

const debugSubscribers = new Set<DebugSubscriber>();

export function addDebugSubscriber(fn: DebugSubscriber): void {
  debugSubscribers.add(fn);
}

export function removeDebugSubscriber(fn: DebugSubscriber): void {
  debugSubscribers.delete(fn);
}

export function createDebugBusStream(): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      const line = chunk.toString().trim();
      if (!line) {
        callback();
        return;
      }
      const envelopeJson = JSON.stringify({ channel: "debug", type: "log", payload: { line } });
      for (const fn of debugSubscribers) {
        try {
          fn(envelopeJson);
        } catch { /* stale subscriber */ }
      }
      callback();
    },
  });
}
