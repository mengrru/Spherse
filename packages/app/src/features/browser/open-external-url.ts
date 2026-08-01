import { useCallback } from "react";
import type { HostKind } from "../../lib/host-bridge";
import { useHostBridge } from "../../context/host-bridge-context";
import { useProjectCtx } from "../../context/project-context";
import { isFeatureEnabled } from "../../lib/feature-registry";
import { useBrowserStore } from "./store";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function isLoopbackUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return LOOPBACK_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

export interface OpenExternalUrlOptions {
  projectId: string;
  hostKind: HostKind;
  openExternal: (url: string) => Promise<void>;
}

export function openExternalUrl(url: string, opts: OpenExternalUrlOptions): void {
  if (isFeatureEnabled("browser", opts.hostKind) && isLoopbackUrl(url)) {
    useBrowserStore.getState().openFloat(opts.projectId, url);
    return;
  }
  void opts.openExternal(url);
}

export function useOpenExternalLink(): (url: string) => void {
  const bridge = useHostBridge();
  const { projectId } = useProjectCtx();
  return useCallback(
    (url: string) =>
      openExternalUrl(url, {
        projectId,
        hostKind: bridge.kind,
        openExternal: bridge.openExternal,
      }),
    [bridge.kind, bridge.openExternal, projectId],
  );
}
