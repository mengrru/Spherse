import type { SdkNavigateEvent } from "./types";

const PROJECT_ROUTE_PATTERN = /^\/project\/[^/]+(?:\/(.*))?$/;
const CHAT_ROUTE_PATTERN = /^chat\/([^/]+)$/;

export function deriveNavigateEvent(pathname: string, search: string): SdkNavigateEvent | null {
  const match = PROJECT_ROUTE_PATTERN.exec(pathname);
  if (!match) return null;

  const subRoute = match[1] ?? "";
  if (subRoute === "") return { kind: "welcome" };

  if (subRoute === "content") {
    const path = new URLSearchParams(search).get("path");
    return path ? { kind: "file", path } : null;
  }

  if (subRoute === "browser") {
    const url = new URLSearchParams(search).get("url");
    return url ? { kind: "browser", url } : null;
  }

  const chatMatch = CHAT_ROUTE_PATTERN.exec(subRoute);
  if (chatMatch) {
    try {
      return { kind: "chat", sessionId: decodeURIComponent(chatMatch[1]) };
    } catch {
      return { kind: "chat", sessionId: chatMatch[1] };
    }
  }

  return null;
}
