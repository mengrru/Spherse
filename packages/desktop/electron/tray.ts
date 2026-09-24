import { app, Menu, Tray, nativeImage } from "electron";
import type { BrowserWindow, MenuItemConstructorOptions } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeLocale, translate, type Locale } from "@spherse/i18n";
import { getCloseToTray, getLocale } from "./settings.js";
import { isQuitting } from "./lifecycle.js";
import { getMainWindow } from "./window.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TrayMenuHandlers {
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

function findDevTrayDir(): string {
  let dir = __dirname;
  for (;;) {
    const candidate = path.join(dir, "resources", "tray");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return candidate;
    dir = parent;
  }
}

function trayIconPath(): string {
  const dir = app.isPackaged ? path.join(process.resourcesPath, "tray") : findDevTrayDir();
  return path.join(dir, process.platform === "darwin" ? "trayTemplate.png" : "tray.png");
}

function createTray(): Tray {
  const iconPath = trayIconPath();
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) console.error("[tray] tray icon not found:", iconPath);
  const created = new Tray(icon);
  created.setToolTip("Spherse");
  created.on("click", () => {
    void showMainWindow();
  });
  if (process.platform === "darwin") {
    created.on("right-click", () => {
      if (trayMenu) created.popUpContextMenu(trayMenu);
    });
  }
  return created;
}

let tray: Tray | null = null;
let trayMenu: Menu | null = null;
let hiddenToTray = false;

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
  hiddenToTray = true;
  if (process.platform === "darwin") app.dock?.hide();
}

export function attachCloseToTray(win: BrowserWindow): void {
  hiddenToTray = false;
  win.on("show", () => {
    hiddenToTray = false;
  });
  win.on("close", (event) => {
    if (isQuitting()) return;
    if (hiddenToTray) {
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
  try {
    if (!tray || tray.isDestroyed()) tray = createTray();
    trayMenu = Menu.buildFromTemplate(
      buildTrayMenuTemplate(normalizeLocale(getLocale()), {
        onShow: () => {
          void showMainWindow();
        },
        onQuit: () => app.quit(),
      }),
    );
    if (process.platform !== "darwin") tray.setContextMenu(trayMenu);
  } catch (err) {
    console.error("[tray] failed to sync tray:", err);
  }
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
  trayMenu = null;
}
