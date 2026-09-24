import { useMemo } from "react";
import { useMatch, useSearchParams } from "react-router";
import { useFeature } from "../../lib/use-feature";
import { tabKey, type TabTarget } from "../../lib/tab-target";
import { isLoopbackUrl } from "../browser";

export function useRouteTabTarget(): TabTarget | null {
  const chatMatch = useMatch("/project/:projectId/chat/:sessionId");
  const contentMatch = useMatch("/project/:projectId/content");
  const browserMatch = useMatch("/project/:projectId/browser");
  const [searchParams] = useSearchParams();
  const browserEnabled = useFeature("browser");

  const sessionId = chatMatch?.params.sessionId ?? null;
  const path = contentMatch ? searchParams.get("path") : null;
  const url = browserMatch && browserEnabled ? searchParams.get("url") : null;

  return useMemo<TabTarget | null>(() => {
    if (sessionId) return { kind: "chat", sessionId };
    if (path) return { kind: "file", path };
    if (url && isLoopbackUrl(url)) return { kind: "browser", url };
    return null;
  }, [sessionId, path, url]);
}

export function useIsWelcomeRoute(): boolean {
  return useMatch("/project/:projectId") !== null;
}

export function useRouteTabKey(): string | null {
  const target = useRouteTabTarget();
  return target ? tabKey(target) : null;
}
