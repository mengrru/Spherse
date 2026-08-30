import { act } from "@testing-library/react";
import { vi } from "vitest";
import { useBusStore } from "../stores/bus-store";
import { createMockHostBridge } from "./host-bridge";

const OPEN = 1;

export interface MockBusSocket {
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  sent: string[];
  close: () => void;
}

let socket: MockBusSocket | null = null;
let originalWebSocket: unknown;

class MockWebSocket {
  static OPEN = OPEN;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  sent: string[] = [];
  constructor() {
    socket = this as unknown as MockBusSocket;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }
}

export function stubMockBusSocket(): void {
  socket = null;
  originalWebSocket = globalThis.WebSocket;
  useBusStore.setState({ status: "idle", resumedAt: null });
  vi.stubGlobal("WebSocket", MockWebSocket);
}

export async function connectMockBus(): Promise<MockBusSocket> {
  await act(async () => {
    await useBusStore.getState().init(createMockHostBridge() as never);
  });
  if (!socket) throw new Error("bus socket not created");
  socket.readyState = OPEN;
  act(() => {
    socket!.onopen?.({} as Event);
  });
  return socket;
}

export function emitBusEvent(event: {
  channel: string;
  projectId: string;
  type: string;
  payload?: unknown;
}): void {
  if (!socket) throw new Error("bus not connected");
  act(() => {
    socket!.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);
  });
}

export function bumpBusResumedAt(): void {
  act(() => {
    useBusStore.setState({ resumedAt: (useBusStore.getState().resumedAt ?? 0) + 1 });
  });
}

export function teardownMockBus(): void {
  act(() => {
    useBusStore.getState().teardown();
    useBusStore.setState({ status: "idle", resumedAt: null });
  });
  socket = null;
  vi.stubGlobal("WebSocket", originalWebSocket as typeof WebSocket);
}
