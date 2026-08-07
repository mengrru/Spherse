import { CHAT_CLOSE_CODES, parseChatServerEvent } from "@spherse/server/contracts";
import type { ApiClient } from "../../../lib/api";
import { buildWsUrl } from "../../../lib/api";
import { parseAgentEvent, type AgentEvent } from "../model/agent-event-parse";
import type { AttachedImage } from "../types";
import {
  mergeHistoryMessages,
  parseHistoryMessages,
} from "../model/chat-history";
import {
  reduceSessionEvents,
  type StreamingSessionData,
} from "../model/chat-session-reducer";

const RECONNECT_BACKOFFS = [1000, 2000, 5000, 10000, 30000];
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const HEARTBEAT_TIMEOUT_MS = 60 * 1000;
const FATAL_CLOSE_CODES = new Set<number>([
  CHAT_CLOSE_CODES.SESSION_UNRECOVERABLE,
]);

export interface ChatSessionRuntimeState extends StreamingSessionData {
  hasMore: boolean;
  oldestLoadedId: number | null;
  historyStatus: "pending" | "syncing" | "ready";
  connectionStatus: "disconnected" | "connecting" | "open";
}

interface ChatSessionRuntimeParams {
  client: ApiClient;
  baseUrl: string;
  projectId: string;
  agentId: string;
  initialMessage?: string;
  accessToken: string | null;
}

interface ChatSessionRuntimeCallbacks<T extends ChatSessionRuntimeState> {
  getSession(): T | undefined;
  updateSession(updater: (session: T) => T): void;
  enqueueEvent(event: AgentEvent): void;
  applyEvents(events: AgentEvent[]): void;
  flushEvents(): void;
  setStreaming(streaming: boolean): void;
  takeInitialMessage(content: string): boolean;
  shouldReconnect(): boolean;
}

export class ChatSessionRuntime<T extends ChatSessionRuntimeState> {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private lastHeartbeatTickAt = 0;
  private awaitingPongSince: number | undefined;
  private reconnectAttempt = 0;
  private manuallyClosed = false;
  private params: ChatSessionRuntimeParams | undefined;

  constructor(
    private readonly sessionId: string,
    private readonly callbacks: ChatSessionRuntimeCallbacks<T>,
  ) {}

  connect(params: ChatSessionRuntimeParams): void {
    this.params = params;
    this.manuallyClosed = false;
    this.clearReconnectTimer();
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    if (this.ws) {
      try {
        this.ws.close();
      } catch (err) {
        console.warn("[chat-session-runtime] failed to close stale WebSocket:", err);
      }
    }

    const ws = new WebSocket(
      buildWsUrl(
        params.baseUrl,
        `/ws/projects/${params.projectId}/chat/${params.agentId}/${this.sessionId}`,
        params.accessToken,
      ),
    );
    this.ws = ws;
    const connectionEvents: AgentEvent[] = [];
    let reconcilingHistory = false;
    let historyWasReady = false;

    const applyConnectionEvents = () => {
      if (connectionEvents.length === 0) return;
      this.callbacks.applyEvents(connectionEvents.splice(0));
    };

    const reconcileHistory = async () => {
      let succeeded = false;
      try {
        const result = await params.client.getSessionMessagesPage(
          params.agentId,
          this.sessionId,
          { turns: 10 },
        );
        if (this.ws !== ws || !this.callbacks.getSession()) return;
        const historyMessages = parseHistoryMessages(result.entries);
        this.callbacks.updateSession((session) => {
          const reconciled = {
            ...session,
            messages: mergeHistoryMessages(session.messages, historyMessages),
            hasMore: result.hasMore,
            oldestLoadedId: result.oldestId,
            historyStatus: "ready" as const,
          };
          return {
            ...reconciled,
            ...reduceSessionEvents(
              reconciled,
              connectionEvents.splice(0),
              Date.now(),
            ),
          };
        });
        succeeded = true;
      } catch (err) {
        console.warn(
          "[chat-session-runtime] failed to reconcile session history:",
          err,
        );
        if (this.ws !== ws || !this.callbacks.getSession()) return;
        applyConnectionEvents();
        this.callbacks.updateSession((session) => ({
          ...session,
          historyStatus: historyWasReady ? "ready" : "pending",
        }));
      } finally {
        reconcilingHistory = false;
        const session = this.callbacks.getSession();
        if (this.ws === ws && session && (succeeded || historyWasReady)) {
          this.callbacks.setStreaming(session.streaming);
        }
      }
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws || !this.callbacks.getSession()) return;
      try {
        const raw = JSON.parse(event.data);
        this.awaitingPongSince = undefined;
        if (raw?.type === "pong") return;
        const parsed = parseAgentEvent(parseChatServerEvent(raw));
        if (reconcilingHistory) {
          connectionEvents.push(parsed);
        } else {
          this.callbacks.enqueueEvent(parsed);
        }
      } catch (err) {
        console.warn("[chat-session-runtime] unparseable ws event:", err);
      }
    };

    ws.onerror = () => {
      if (this.ws !== ws || !this.callbacks.getSession()) return;
      console.warn("[chat-session-runtime] WebSocket connection error");
    };

    ws.onclose = (event) => {
      if (this.ws !== ws || !this.callbacks.getSession()) return;
      this.ws = null;
      this.clearHeartbeatTimer();
      if (reconcilingHistory) applyConnectionEvents();
      this.callbacks.flushEvents();
      const fatal = FATAL_CLOSE_CODES.has(event.code);
      this.callbacks.updateSession((session) => ({
        ...session,
        connectionStatus: "disconnected",
        historyStatus:
          session.historyStatus === "syncing"
            ? (historyWasReady ? "ready" : "pending")
            : session.historyStatus,
        messages: fatal
          ? session.messages.map((message) => (
              message._streaming
                ? { ...message, _streaming: false }
                : message
            ))
          : session.messages,
        streaming: fatal ? false : session.streaming,
      }));
      if (fatal) {
        this.callbacks.setStreaming(false);
        this.manuallyClosed = true;
        return;
      }
      if (!this.manuallyClosed && this.callbacks.shouldReconnect()) {
        this.scheduleReconnect();
      }
    };

    ws.onopen = () => {
      if (this.ws !== ws || !this.callbacks.getSession()) return;
      this.startHeartbeat(ws);
      this.reconnectAttempt = 0;
      historyWasReady =
        this.callbacks.getSession()?.historyStatus === "ready";
      reconcilingHistory = true;
      this.callbacks.updateSession((session) => ({
        ...session,
        connectionStatus: "open",
        historyStatus: "syncing",
      }));
      void reconcileHistory();
      if (
        params.initialMessage &&
        this.callbacks.takeInitialMessage(params.initialMessage)
      ) {
        ws.send(JSON.stringify({
          type: "message",
          content: params.initialMessage,
        }));
      }
    };

    this.callbacks.updateSession((session) => ({
      ...session,
      connectionStatus: "connecting",
    }));
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  sendMessage(content: string, image?: AttachedImage): boolean {
    if (!this.isOpen()) return false;
    const payload: Record<string, unknown> = { type: "message", content };
    if (image) {
      payload.attachments = [{ type: "image", path: image.path, mimeType: image.mimeType }];
    }
    this.ws?.send(JSON.stringify(payload));
    return true;
  }

  abort(): boolean {
    if (!this.isOpen()) return false;
    this.ws?.send(JSON.stringify({ type: "abort" }));
    return true;
  }

  respondApproval(requestId: string, approved: boolean): boolean {
    if (!this.isOpen()) return false;
    this.ws?.send(JSON.stringify({
      type: "resolve_control_request",
      requestId,
      kind: "approval",
      approved,
    }));
    return true;
  }

  dispose(): void {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch (err) {
        console.warn("[chat-session-runtime] failed to close WebSocket:", err);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.manuallyClosed || !this.params) return;
    const delay = RECONNECT_BACKOFFS[
      Math.min(this.reconnectAttempt, RECONNECT_BACKOFFS.length - 1)
    ];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.params) this.connect(this.params);
    }, delay);
  }

  private startHeartbeat(ws: WebSocket): void {
    this.clearHeartbeatTimer();
    this.lastHeartbeatTickAt = Date.now();
    this.awaitingPongSince = undefined;
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      if (now - this.lastHeartbeatTickAt > HEARTBEAT_TIMEOUT_MS) {
        this.awaitingPongSince = undefined;
      }
      this.lastHeartbeatTickAt = now;
      if (
        this.awaitingPongSince !== undefined &&
        now - this.awaitingPongSince >= HEARTBEAT_TIMEOUT_MS
      ) {
        try {
          ws.close();
        } catch (err) {
          console.warn("[chat-session-runtime] heartbeat close failed:", err);
        }
        return;
      }
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "ping" }));
          this.awaitingPongSince ??= now;
        } catch (err) {
          console.warn("[chat-session-runtime] heartbeat ping failed:", err);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private clearHeartbeatTimer(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }
}
