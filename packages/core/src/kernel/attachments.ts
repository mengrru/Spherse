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
