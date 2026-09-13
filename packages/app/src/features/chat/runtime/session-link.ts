import {
  CHAT_CLOSE_CODES,
  type ChatClientMessage,
} from "@spherse/contracts";
import { buildWsUrl, type ApiClient } from "../../../lib/api";
import {
  WsConnection,
  type WsConnectionStateChange,
} from "../../../lib/ws/ws-connection";
import { decodeServerFrame, type DecodedFrame } from "./decode";

export interface SessionLinkParams {
  client: ApiClient;
  baseUrl: string;
  projectId: string;
  agentId: string;
  sessionId: string;
  accessToken: string | null;
  initialMessage?: string;
}

export interface SessionLinkHandlers {
  onOpen(since: number | undefined): void;
  onClose(): void;
  onStateChange(change: WsConnectionStateChange): void;
  onFrame(frame: DecodedFrame): void;
  getSince(): number | undefined;
  isAttached(): boolean;
}

export interface SessionLink {
  connect(): void;
  reconnect(): void;
  probe(): void;
  send(message: ChatClientMessage): boolean;
  dispose(): void;
  isOpen(): boolean;
}

const RECONNECT_BACKOFFS = [1000, 2000, 5000, 10000, 30000];
const MAX_RECONNECT_ATTEMPTS = 10;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const HEARTBEAT_TIMEOUT_MS = 60 * 1000;
const RESUME_PROBE_TIMEOUT_MS = 5 * 1000;
const FATAL_CLOSE_CODES = new Set<number>([
  CHAT_CLOSE_CODES.PROTOCOL_ERROR,
  CHAT_CLOSE_CODES.SESSION_UNRECOVERABLE,
  CHAT_CLOSE_CODES.MIGRATION_REQUIRED,
]);

export function createSessionLink(
  getParams: () => SessionLinkParams,
  handlers: SessionLinkHandlers,
): SessionLink {
  let open = false;
  let lastSince: number | undefined;
  const connection = new WsConnection(
    {
      url: () => {
        const params = getParams();
        lastSince = handlers.getSince();
        const path = `/ws/projects/${params.projectId}/chat/${params.agentId}/${params.sessionId}`;
        return buildWsUrl(
          params.baseUrl,
          lastSince !== undefined ? `${path}?since=${lastSince}` : path,
          params.accessToken,
        );
      },
      heartbeat: { pingIntervalMs: HEARTBEAT_INTERVAL_MS, pongTimeoutMs: HEARTBEAT_TIMEOUT_MS },
      backoffMs: RECONNECT_BACKOFFS,
      maxRetries: MAX_RECONNECT_ATTEMPTS,
      fatalCloseCodes: FATAL_CLOSE_CODES,
      probeTimeoutMs: RESUME_PROBE_TIMEOUT_MS,
      pingPayload: JSON.stringify({ type: "ping" }),
      isPong: (parsed) => (parsed as { type?: unknown })?.type === "pong",
      shouldRetry: () => handlers.isAttached(),
      label: "chat-ws",
    },
    {
      onMessage: (parsed) => {
        handlers.onFrame(decodeServerFrame(parsed));
      },
      onStateChange: (change) => {
        handlers.onStateChange(change);
        if (change.state === "open") {
          open = true;
          handlers.onOpen(lastSince);
          return;
        }
        if (
          open &&
          (change.state === "waiting-backoff" ||
            change.state === "failed" ||
            change.state === "fatal" ||
            change.state === "closed")
        ) {
          open = false;
          handlers.onClose();
        }
      },
    },
  );

  return {
    connect: () => {
      void connection.connect();
    },
    reconnect: () => {
      void connection.reconnect();
    },
    probe: () => connection.probe(),
    send: (message) => connection.send(JSON.stringify(message)),
    dispose: () => connection.close(),
    isOpen: () => connection.getState() === "open",
  };
}
