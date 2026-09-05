import { vi } from "vitest";

export interface MockWebSocketInstance {
  url: string;
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  sent: string[];
  closeSpy: ReturnType<typeof vi.fn>;
  close: () => void;
}

export const WS_CONNECTING = 0;
export const WS_OPEN = 1;
export const WS_CLOSING = 2;
export const WS_CLOSED = 3;

export function createMockWebSocket() {
  const instances: MockWebSocketInstance[] = [];

  class MockWebSocket {
    static CONNECTING = WS_CONNECTING;
    static OPEN = WS_OPEN;
    static CLOSING = WS_CLOSING;
    static CLOSED = WS_CLOSED;
    url: string;
    readyState = WS_CONNECTING;
    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onclose: ((ev: CloseEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    sent: string[] = [];
    closeSpy = vi.fn();

    constructor(url: string) {
      this.url = url;
      instances.push(this as unknown as MockWebSocketInstance);
    }

    send(data: string) {
      this.sent.push(data);
    }

    close() {
      if (this.readyState === WS_CLOSED) return;
      this.readyState = WS_CLOSED;
      this.closeSpy();
      this.onclose?.({ code: 1000 } as CloseEvent);
    }
  }

  return { MockWebSocket, instances };
}

export function openInstance(instance: MockWebSocketInstance): void {
  instance.readyState = WS_OPEN;
  instance.onopen?.({} as Event);
}
