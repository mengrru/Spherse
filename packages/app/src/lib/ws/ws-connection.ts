export type WsConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "waiting-backoff"
  | "failed"
  | "fatal"
  | "closed";

export interface WsConnectionStateChange {
  state: WsConnectionState;
  attempt: number;
  delayMs: number;
  closeCode: number | undefined;
}

export interface WsConnectionConfig {
  url: () => string | Promise<string>;
  heartbeat: { pingIntervalMs: number; pongTimeoutMs: number };
  backoffMs: readonly number[];
  maxRetries: number;
  fatalCloseCodes: ReadonlySet<number>;
  probeTimeoutMs: number;
  pingPayload: string;
  isPong: (parsed: unknown) => boolean;
  label: string;
}

export interface WsConnectionHandlers {
  onMessage: (parsed: unknown) => void;
  onStateChange: (change: WsConnectionStateChange) => void;
}

const OPEN = 1;

export class WsConnection {
  private ws: WebSocket | null = null;
  private gen = 0;
  private retryAttempt = 0;
  private manual = false;
  private backoffTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private probeTimer: ReturnType<typeof setTimeout> | undefined;
  private lastHeartbeatTickAt = 0;
  private awaitingPongSince: number | undefined;
  private state: WsConnectionState = "idle";

  constructor(
    private readonly config: WsConnectionConfig,
    private readonly handlers: WsConnectionHandlers,
  ) {}

  getState(): WsConnectionState {
    return this.state;
  }

  connect(): Promise<void> {
    if (this.state === "connecting" || this.state === "open") return Promise.resolve();
    this.manual = false;
    return this.openSocket();
  }

  reconnect(): Promise<void> {
    this.retryAttempt = 0;
    this.manual = false;
    return this.openSocket();
  }

  send(data: string): boolean {
    if (!this.ws || this.ws.readyState !== OPEN) return false;
    try {
      this.ws.send(data);
      return true;
    } catch {
      return false;
    }
  }

  probe(): void {
    this.clearProbeTimer();
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) return;
    if (this.awaitingPongSince === undefined) {
      const startedAt = Date.now();
      this.awaitingPongSince = startedAt;
      try {
        ws.send(this.config.pingPayload);
      } catch (err) {
        this.awaitingPongSince = undefined;
        console.warn(`[${this.config.label}] probe ping failed:`, err);
        return;
      }
    } else if (Date.now() - this.awaitingPongSince >= this.config.heartbeat.pongTimeoutMs) {
      this.safeClose(ws);
      return;
    }
    const pendingSince = this.awaitingPongSince;
    this.probeTimer = setTimeout(() => {
      this.probeTimer = undefined;
      if (this.ws !== ws || this.ws.readyState !== OPEN) return;
      if (this.awaitingPongSince !== undefined && this.awaitingPongSince <= pendingSince) {
        this.safeClose(ws);
      }
    }, this.config.probeTimeoutMs);
  }

  close(): void {
    this.manual = true;
    this.gen += 1;
    this.clearBackoffTimer();
    this.clearHeartbeatTimer();
    this.clearProbeTimer();
    const ws = this.ws;
    this.ws = null;
    if (ws) this.safeClose(ws);
    this.setState("closed");
  }

  private async openSocket(): Promise<void> {
    this.clearBackoffTimer();
    this.replaceSocket();
    const gen = ++this.gen;
    let url: string | Awaited<string> | undefined;
    try {
      url = await this.config.url();
    } catch (err) {
      console.warn(`[${this.config.label}] failed to resolve ws url:`, err);
      url = undefined;
    }
    if (gen !== this.gen || this.manual) return;
    if (!url) {
      if (this.retryAttempt > 0) this.scheduleRetry();
      return;
    }
    this.setState("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.warn(`[${this.config.label}] failed to construct WebSocket:`, err);
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retryAttempt = 0;
      this.startHeartbeat(ws);
      this.setState("open");
    };

    ws.onmessage = (event: MessageEvent) => {
      if (this.ws !== ws) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch (err) {
        console.warn(`[${this.config.label}] unparseable ws message:`, err);
        return;
      }
      this.awaitingPongSince = undefined;
      if (this.config.isPong(parsed)) {
        this.clearProbeTimer();
        return;
      }
      this.handlers.onMessage(parsed);
    };

    ws.onerror = () => {
      if (this.ws !== ws) return;
      this.safeClose(ws);
    };

    ws.onclose = (event: CloseEvent) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearHeartbeatTimer();
      this.clearProbeTimer();
      if (this.manual) {
        this.setState("closed");
        return;
      }
      if (this.config.fatalCloseCodes.has(event.code)) {
        this.setState("fatal", { closeCode: event.code });
        return;
      }
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (this.retryAttempt >= this.config.maxRetries) {
      this.setState("failed");
      return;
    }
    const delay = this.config.backoffMs[
      Math.min(this.retryAttempt, this.config.backoffMs.length - 1)
    ];
    this.retryAttempt += 1;
    this.setState("waiting-backoff", { attempt: this.retryAttempt, delayMs: delay });
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = undefined;
      void this.openSocket();
    }, delay);
  }

  private replaceSocket(): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    this.clearHeartbeatTimer();
    this.clearProbeTimer();
    this.safeClose(ws);
  }

  private startHeartbeat(ws: WebSocket): void {
    this.clearHeartbeatTimer();
    this.lastHeartbeatTickAt = Date.now();
    this.awaitingPongSince = undefined;
    const { pingIntervalMs, pongTimeoutMs } = this.config.heartbeat;
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      if (now - this.lastHeartbeatTickAt > pongTimeoutMs) {
        this.awaitingPongSince = undefined;
      }
      this.lastHeartbeatTickAt = now;
      if (
        this.awaitingPongSince !== undefined &&
        now - this.awaitingPongSince >= pongTimeoutMs
      ) {
        this.safeClose(ws);
        return;
      }
      if (ws.readyState === OPEN) {
        try {
          ws.send(this.config.pingPayload);
          this.awaitingPongSince ??= now;
        } catch (err) {
          console.warn(`[${this.config.label}] heartbeat ping failed:`, err);
        }
      }
    }, pingIntervalMs);
  }

  private setState(
    state: WsConnectionState,
    extra?: { attempt?: number; delayMs?: number; closeCode?: number },
  ): void {
    this.state = state;
    this.handlers.onStateChange({
      state,
      attempt: extra?.attempt ?? 0,
      delayMs: extra?.delayMs ?? 0,
      closeCode: extra?.closeCode,
    });
  }

  private safeClose(ws: WebSocket): void {
    try {
      ws.close();
    } catch (err) {
      console.warn(`[${this.config.label}] failed to close WebSocket:`, err);
    }
  }

  private clearBackoffTimer(): void {
    if (!this.backoffTimer) return;
    clearTimeout(this.backoffTimer);
    this.backoffTimer = undefined;
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
