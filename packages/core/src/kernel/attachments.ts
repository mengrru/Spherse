import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { EventMiddleware } from "./event-pipeline.js";

export type PreparedContentBlock =
  | { type: "image"; data: string; mimeType: string }
  | { type: "text"; text: string };

export interface AttachmentLike {
  type: string;
  path: string;
  mimeType: string;
  meta?: Record<string, unknown>;
}

export interface AttachmentProcessor {
  readonly type: string;
  preprocess(ctx: {
    projectRoot: string;
    attachment: AttachmentLike;
  }): Promise<PreparedContentBlock[]>;
}

export interface TurnMiddlewareSource {
  eventMiddlewares?: ReadonlyArray<EventMiddleware<AgentEvent>>;
}
