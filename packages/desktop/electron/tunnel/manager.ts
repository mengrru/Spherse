import type { TunnelProvider, TunnelSession } from "./provider.js";
import { CloudflareTunnelProvider } from "./cloudflare-provider.js";

export interface TunnelManagerState {
  status: "stopped" | "starting" | "running" | "error";
  publicUrl: string | null;
  startedAt: string | null;
  error: string | null;
}

type StateListener = (state: TunnelManagerState) => void;

export class TunnelManager {
  private provider: TunnelProvider;
  private session: TunnelSession | null = null;
  private state: TunnelManagerState = {
    status: "stopped",
    publicUrl: null,
    startedAt: null,
    error: null,
  };
  private readonly listeners = new Set<StateListener>();
  private starting: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;

  constructor(provider?: TunnelProvider) {
    this.provider = provider ?? new CloudflareTunnelProvider();
  }

  getState(): TunnelManagerState {
    return { ...this.state };
  }

  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async start(localPort: number): Promise<TunnelManagerState> {
    if (this.state.status === "running" && this.session) {
      return this.state;
    }
    if (this.starting) {
      await this.starting;
      return this.state;
    }
    if (this.stopping) {
      await this.stopping;
    }

    this.starting = this.doStart(localPort);
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
    return this.state;
  }

  async restart(localPort: number): Promise<TunnelManagerState> {
    await this.stop();
    return this.start(localPort);
  }

  async stop(): Promise<TunnelManagerState> {
    if (this.stopping) {
      await this.stopping;
      return this.state;
    }
    if (!this.session && this.state.status === "stopped") {
      return this.state;
    }
    this.stopping = this.doStop();
    try {
      await this.stopping;
    } finally {
      this.stopping = null;
    }
    return this.state;
  }

  private async doStart(localPort: number): Promise<void> {
    this.updateState({ status: "starting", publicUrl: null, startedAt: null, error: null });
    try {
      const session = await this.provider.start(localPort);
      this.session = session;
      session.onStop(() => {
        this.session = null;
        this.updateState({ status: "stopped", publicUrl: null, startedAt: null, error: null });
      });
      this.updateState({
        status: "running",
        publicUrl: session.publicUrl,
        startedAt: session.startedAt,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.updateState({ status: "error", publicUrl: null, startedAt: null, error: message });
    }
  }

  private async doStop(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (session) {
      try { await session.stop(); } catch { /* ignore */ }
    }
    this.updateState({ status: "stopped", publicUrl: null, startedAt: null, error: null });
  }

  private updateState(patch: TunnelManagerState): void {
    this.state = patch;
    for (const listener of this.listeners) {
      try { listener(this.state); } catch { /* listener error */ }
    }
  }
}

let singleton: TunnelManager | null = null;

export function getTunnelManager(): TunnelManager {
  if (!singleton) singleton = new TunnelManager();
  return singleton;
}
