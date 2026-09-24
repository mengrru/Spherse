import type { SessionInfo } from "./types";

export function sessionFallbackTitle(session: Pick<SessionInfo, "updatedAt">): string {
  return new Date(session.updatedAt).toLocaleString();
}

export function sessionDisplayTitle(session: Pick<SessionInfo, "title" | "updatedAt">): string {
  return session.title ?? sessionFallbackTitle(session);
}
