import { app, Menu, Tray, nativeImage } from "electron";
import type { BrowserWindow, MenuItemConstructorOptions } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeLocale, translate, type Locale } from "@spherse/i18n";
import { getCloseToTray, getLocale } from "./settings.js";
import { isQuitting } from "./lifecycle.js";
import { getMainWindow } from "./window.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface TrayMenuHandlers {
  onShow: () => void;
  onQuit: () => void;
}

export function buildTrayMenuTemplate(
  locale: Locale,
  handlers: TrayMenuHandlers,
): MenuItemConstructorOptions[] {
  return [
    { label: translate(locale, "tray.show"), click: handlers.onShow },
    { type: "separator" },
    { label: translate(locale, "tray.quit"), click: handlers.onQuit },
  ];
}

function trayIconPath(): string {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, "tray")
    : path.join(__dirname, "../../resources/tray");
  return path.join(dir, process.platform === "darwin" ? "trayTemplate.png" : "tray.png");
}

let tray: Tray | null = null;
let trayMenu: Menu | null = null;

export async function showMainWindow(): Promise<void> {
  const win = getMainWindow();
  if (isQuitting() || !win || win.isDestroyed()) return;
  if (process.platform === "darwin") await app.dock?.show();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (process.platform === "darwin") app.focus({ steal: true });
}

function hideToTray(win: BrowserWindow): void {
  if (win.isFullScreen()) {
    win.once("leave-full-screen", () => hideToTray(win));
    win.setFullScreen(false);
    return;
  }
  win.hide();
  if (process.platform === "darwin") app.dock?.hide();
}

export function attachCloseToTray(win: BrowserWindow): void {
  win.on("close", (event) => {
    if (isQuitting()) return;
    if (!win.isVisible() && !win.isMinimized()) {
      event.preventDefault();
      app.quit();
      return;
    }
    if (!getCloseToTray()) return;
    event.preventDefault();
    hideToTray(win);
  });
}

export function syncTray(): void {
  if (!getCloseToTray()) {
    destroyTray();
    return;
  }
  if (!tray || tray.isDestroyed()) {
    const created = new Tray(nativeImage.createFromPath(trayIconPath()));
    created.setToolTip("Spherse");
    created.on("click", () => {
      void showMainWindow();
    });
    if (process.platform === "darwin") {
      created.on("right-click", () => {
        if (trayMenu) created.popUpContextMenu(trayMenu);
      });
    }
    tray = created;
  }
  trayMenu = Menu.buildFromTemplate(
    buildTrayMenuTemplate(normalizeLocale(getLocale()), {
      onShow: () => {
        void showMainWindow();
      },
      onQuit: () => app.quit(),
    }),
  );
  if (process.platform !== "darwin") tray.setContextMenu(trayMenu);
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
  trayMenu = null;
}
