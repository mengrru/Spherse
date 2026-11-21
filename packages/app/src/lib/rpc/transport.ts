import type { RpcClientFrame, RpcServerFrame } from "@spherse/contracts";

export interface RpcTransport {
  connect(): Promise<void>;
  send(frame: RpcClientFrame): void;
  onFrame(handler: (frame: RpcServerFrame) => void): () => void;
  onClosed(handler: () => void): () => void;
  close(): void;
}
