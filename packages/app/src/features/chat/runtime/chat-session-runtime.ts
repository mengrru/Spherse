import { CHAT_CLOSE_CODES, parseChatServerEvent } from "@spherse/contracts";
import type { ApiClient } from "../../../lib/api";
import { buildWsUrl } from "../../../lib/api";
import { parseAgentEvent, type AgentEvent } from "../model/agent-event-parse";
import type { SendableImage } from "../types";
import {
  applyFatalClose,
  beginHistorySync,
  markHistoryFailed,
  markHistoryInterrupted,
  type HistoryApplyMode,
  type HistoryPageResult,
} from "../model/session-events";
import type { ChatSessionData } from "../types";

const RECONNECT_BACKOFFS = [1000, 2000, 5000, 10000, 30000];
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONCILE_BACKOFFS = [1000, 2000, 5000];
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const HEARTBEAT_TIMEOUT_MS = 60 * 1000;
const RESUME_PROBE_TIMEOUT_MS = 5 * 1000;
const FATAL_CLOSE_CODES = new Set<number>([
  CHAT_CLOSE_CODES.SESSION_UNRECOVERABLE,
]);

export interface ChatSessionRuntimeState extends ChatSessionData {
  connectionStatus: "disconnected" | "connecting" | "open";
  reconnectFailed: boolean;
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
  applyHistoryResult(result: HistoryPageResult, mode: HistoryApplyMode): void;
  flushEvents(): void;
  takeInitialMessage(content: string): boolean;
  shouldReconnect(): boolean;
}

export class ChatSessionRuntime<T extends ChatSessionRuntimeState> {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private probeTimer: ReturnType<typeof setTimeout> | undefined;
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
      try {
        for (let attempt = 0; attempt <= RECONCILE_BACKOFFS.length; attempt++) {
          try {
            const result = await params.client.getSessionMessagesPage(
              params.agentId,
              this.sessionId,
              { limit: 20 },
            );
            if (this.ws !== ws || !this.callbacks.getSession()) return;
            this.callbacks.applyHistoryResult(result, "reconcile");
            const buffered = connectionEvents.splice(0);
            if (buffered.length > 0) this.callbacks.applyEvents(buffered);
            return;
          } catch (err) {
            console.warn(
              "[chat-session-runtime] failed to reconcile session history:",
              err,
            );
            if (this.ws !== ws || !this.callbacks.getSession()) return;
            if (attempt < RECONCILE_BACKOFFS.length) {
              await new Promise((r) => setTimeout(r, RECONCILE_BACKOFFS[attempt]));
              if (this.ws !== ws || !this.callbacks.getSession()) return;
              continue;
            }
            applyConnectionEvents();
            this.callbacks.updateSession((session) => markHistoryFailed(session, historyWasReady));
          }
        }
      } finally {
        reconcilingHistory = false;
      }
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws || !this.callbacks.getSession()) return;
      try {
        const raw = JSON.parse(event.data);
        this.awaitingPongSince = undefined;
        if (raw?.type === "pong") {
          this.clearProbeTimer();
          return;
        }
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
      try {
        ws.close();
      } catch (err) {
        console.warn("[chat-session-runtime] failed to close socket on error:", err);
      }
    };

    ws.onclose = (event) => {
      if (this.ws !== ws || !this.callbacks.getSession()) return;
      this.ws = null;
      this.clearHeartbeatTimer();
      if (reconcilingHistory) applyConnectionEvents();
      this.callbacks.flushEvents();
      const fatal = FATAL_CLOSE_CODES.has(event.code);
      this.callbacks.updateSession((session) => ({
        ...(fatal ? applyFatalClose(session) : session),
        connectionStatus: "disconnected",
        history: markHistoryInterrupted(session, historyWasReady).history,
      }));
      if (fatal) {
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
        this.callbacks.getSession()?.history.historyStatus === "ready";
      reconcilingHistory = true;
      this.callbacks.updateSession((session) => ({
        ...beginHistorySync(session),
        connectionStatus: "open",
        reconnectFailed: false,
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

  /**
   * Actively probe the socket for liveness after a host resume (e.g. iOS
   * background suspension may leave the socket silently dead). Sends a ping
   * with a short probe timeout; a dead link is closed so the existing
   * reconnect + history-reconcile path takes over. No-op when the socket is
   * not OPEN or a ping is already pending (the heartbeat watchdog owns that
   * case).
   */
  probe(): void {
    this.clearProbeTimer();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const ws = this.ws;
    if (this.awaitingPongSince !== undefined) {
      // A ping is already pending (heartbeat or an earlier probe): re-arm the
      // short probe against it instead of silently falling back to the 60s
      // heartbeat watchdog.
      const pendingSince = this.awaitingPongSince;
      this.probeTimer = setTimeout(() => {
        this.probeTimer = undefined;
        if (this.ws !== ws || this.ws.readyState !== WebSocket.OPEN) return;
        if (this.awaitingPongSince !== undefined && this.awaitingPongSince <= pendingSince) {
          try {
            ws.close();
          } catch (err) {
            console.warn("[chat-session-runtime] probe close failed:", err);
          }
        }
      }, RESUME_PROBE_TIMEOUT_MS);
      return;
    }
    const probeStartedAt = Date.now();
    this.awaitingPongSince = probeStartedAt;
    try {
      ws.send(JSON.stringify({ type: "ping" }));
    } catch (err) {
      this.awaitingPongSince = undefined;
      console.warn("[chat-session-runtime] probe ping failed:", err);
      return;
    }
    this.probeTimer = setTimeout(() => {
      this.probeTimer = undefined;
      if (this.ws !== ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (this.awaitingPongSince !== undefined && this.awaitingPongSince <= probeStartedAt) {
        try {
          ws.close();
        } catch (err) {
          console.warn("[chat-session-runtime] probe close failed:", err);
        }
      }
    }, RESUME_PROBE_TIMEOUT_MS);
  }

  sendMessage(content: string, image?: SendableImage): boolean {
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

  retry(): boolean {
    if (!this.isOpen()) return false;
    this.ws?.send(JSON.stringify({ type: "retry" }));
    return true;
  }

  withdraw(): boolean {
    if (!this.isOpen()) return false;
    this.ws?.send(JSON.stringify({ type: "withdraw" }));
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

  respondQuestion(requestId: string, answer: string): boolean {
    if (!this.isOpen()) return false;
    this.ws?.send(JSON.stringify({
      type: "resolve_control_request",
      requestId,
      kind: "question",
      answer,
    }));
    return true;
  }

  dispose(): void {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    this.clearProbeTimer();
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

  reconnect(): void {
    if (!this.params) return;
    this.reconnectAttempt = 0;
    this.callbacks.updateSession((session) => ({ ...session, reconnectFailed: false }));
    this.clearReconnectTimer();
    this.connect(this.params);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.manuallyClosed || !this.params) return;
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.callbacks.updateSession((session) => ({ ...session, reconnectFailed: true }));
      return;
    }
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

  private clearProbeTimer(): void {
    if (!this.probeTimer) return;
    clearTimeout(this.probeTimer);
    this.probeTimer = undefined;
  }
}
