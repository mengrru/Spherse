export interface TunnelProvider {
  readonly id: string;
  start(localPort: number): Promise<TunnelSession>;
}

export interface TunnelSession {
  readonly publicUrl: string;
  readonly startedAt: string;
  onStop(fn: () => void): void;
  stop(): Promise<void>;
}
