import { ipcMain, type BrowserWindow } from "electron";
import type { MobileAccessEvent, MobileAccessState, MobileTunnelMode } from "@spherse/app/src/lib/host-bridge";
import { getTunnelManager } from "../tunnel/manager.js";
import {
  getMobileAccess,
  setMobileAccess,
  generateAccessToken,
} from "../settings.js";
import { ensureServer, restartServerWithAuth, getServerPort } from "../server.js";

const MOBILE_EVENT_CHANNEL = "mobile-access:event";

function safeServerPort(): number | null {
  try {
    return getServerPort();
  } catch {
    return null;
  }
}

function normalizeDomain(input: string | undefined): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, "");
  return `https://${trimmed}`.replace(/\/+$/, "");
}

export { normalizeDomain };

export function buildState(): MobileAccessState {
  const mobile = getMobileAccess();
  const mode = mobile.mode ?? "quick";
  const serverPort = safeServerPort();
  const manualDomain = mobile.publicDomain?.trim() ? normalizeDomain(mobile.publicDomain) : null;

  if (mode === "manual") {
    return {
      enabled: mobile.enabled,
      token: mobile.token ?? null,
      mode,
      serverPort,
      manualDomain,
      tunnel: {
        status: "stopped",
        publicUrl: manualDomain,
        startedAt: null,
        error: null,
      },
    };
  }

  const tunnel = getTunnelManager().getState();
  return {
    enabled: mobile.enabled,
    token: mobile.token ?? null,
    mode,
    serverPort,
    manualDomain,
    tunnel: {
      status: tunnel.status,
      publicUrl: tunnel.publicUrl,
      startedAt: tunnel.startedAt,
      error: tunnel.error,
    },
  };
}

function makeBroadcaster(getWindow: () => BrowserWindow | null) {
  return (state: MobileAccessState): void => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const event: MobileAccessEvent = { type: "state", state };
    win.webContents.send(MOBILE_EVENT_CHANNEL, event);
  };
}

let mutationChain: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = mutationChain.then(task, task);
  mutationChain = next.catch(() => undefined);
  return next;
}

export function registerMobileAccessIpc(getWindow: () => BrowserWindow | null): void {
  const broadcast = makeBroadcaster(getWindow);

  getTunnelManager().onStateChange(() => {
    if (getMobileAccess().mode !== "manual") {
      broadcast(buildState());
    }
  });

  ipcMain.handle("mobile-access:get-state", async (): Promise<MobileAccessState> => {
    return buildState();
  });

  ipcMain.handle(
    "mobile-access:enable",
    async (_evt, options?: { mode?: MobileTunnelMode; publicDomain?: string }): Promise<MobileAccessState> => {
      return serialize(async () => {
        const mode = options?.mode ?? "quick";
        const publicDomain = mode === "manual" ? normalizeDomain(options?.publicDomain) : undefined;
        const current = getMobileAccess();
        const token = current.token ?? generateAccessToken();
        setMobileAccess({ enabled: true, token, mode, publicDomain });
        await restartServerWithAuth(token);
        await ensureServer();
        if (mode === "quick") {
          await getTunnelManager().start(getServerPort());
        } else {
          await getTunnelManager().stop();
        }
        return buildState();
      });
    },
  );

  ipcMain.handle("mobile-access:disable", async (): Promise<MobileAccessState> => {
    return serialize(async () => {
      setMobileAccess({ enabled: false });
      await getTunnelManager().stop();
      return buildState();
    });
  });

  ipcMain.handle("mobile-access:regenerate-token", async (): Promise<MobileAccessState> => {
    return serialize(async () => {
      const current = getMobileAccess();
      const token = generateAccessToken();
      setMobileAccess({ token });
      await restartServerWithAuth(token);
      await ensureServer();
      if (current.enabled && current.mode === "quick") {
        await getTunnelManager().restart(getServerPort());
      }
      return buildState();
    });
  });

  ipcMain.handle("mobile-access:restart-tunnel", async (): Promise<MobileAccessState> => {
    return serialize(async () => {
      const current = getMobileAccess();
      if (!current.enabled || current.mode !== "quick") {
        return buildState();
      }
      await getTunnelManager().restart(getServerPort());
      return buildState();
    });
  });

  ipcMain.handle(
    "mobile-access:set-mode",
    async (_evt, mode: MobileTunnelMode): Promise<MobileAccessState> => {
      return serialize(async () => {
        const current = getMobileAccess();
        setMobileAccess({ mode });
        if (mode === "manual") {
          await getTunnelManager().stop();
          if (!current.token) {
            const token = generateAccessToken();
            setMobileAccess({ token });
            await restartServerWithAuth(token);
            await ensureServer();
          }
        } else {
          if (current.enabled) {
            await getTunnelManager().start(getServerPort());
          } else {
            await getTunnelManager().stop();
          }
        }
        return buildState();
      });
    },
  );

  ipcMain.handle(
    "mobile-access:set-public-domain",
    async (_evt, domain: string): Promise<MobileAccessState> => {
      return serialize(async () => {
        setMobileAccess({ publicDomain: normalizeDomain(domain) });
        return buildState();
      });
    },
  );
}

export { MOBILE_EVENT_CHANNEL };
