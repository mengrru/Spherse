import { ipcMain, type BrowserWindow } from "electron";
import type { MobileAccessEvent, MobileAccessState } from "@spherse/app/src/lib/host-bridge";
import { getTunnelManager } from "../tunnel/manager.js";
import {
  getMobileAccess,
  setMobileAccess,
  generateAccessToken,
} from "../settings.js";
import { ensureServer, restartServerWithAuth, getServerPort } from "../server.js";

const MOBILE_EVENT_CHANNEL = "mobile-access:event";

function buildState(): MobileAccessState {
  const mobile = getMobileAccess();
  const tunnel = getTunnelManager().getState();
  return {
    enabled: mobile.enabled,
    token: mobile.token ?? null,
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
    broadcast(buildState());
  });

  ipcMain.handle("mobile-access:get-state", async (): Promise<MobileAccessState> => {
    return buildState();
  });

  ipcMain.handle("mobile-access:enable", async (): Promise<MobileAccessState> => {
    return serialize(async () => {
      const current = getMobileAccess();
      const token = current.token ?? generateAccessToken();
      setMobileAccess({ enabled: true, token });
      await restartServerWithAuth(token);
      await ensureServer();
      await getTunnelManager().start(getServerPort());
      return buildState();
    });
  });

  ipcMain.handle("mobile-access:disable", async (): Promise<MobileAccessState> => {
    return serialize(async () => {
      setMobileAccess({ enabled: false });
      await getTunnelManager().stop();
      await restartServerWithAuth(undefined);
      await ensureServer();
      return buildState();
    });
  });

  ipcMain.handle("mobile-access:regenerate-token", async (): Promise<MobileAccessState> => {
    return serialize(async () => {
      const current = getMobileAccess();
      const token = generateAccessToken();
      setMobileAccess({ token });
      if (current.enabled) {
        await restartServerWithAuth(token);
        await ensureServer();
        await getTunnelManager().restart(getServerPort());
      }
      return buildState();
    });
  });

  ipcMain.handle("mobile-access:restart-tunnel", async (): Promise<MobileAccessState> => {
    return serialize(async () => {
      const current = getMobileAccess();
      if (!current.enabled) {
        return buildState();
      }
      await getTunnelManager().restart(getServerPort());
      return buildState();
    });
  });
}

export { MOBILE_EVENT_CHANNEL };
