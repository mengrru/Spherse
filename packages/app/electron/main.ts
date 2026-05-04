import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import { createServer } from "@worldbuilding-agent/server";
import Store from "electron-store";
import type { AppSettings } from "@worldbuilding-agent/core";
import { SUPPORTED_PROVIDERS, type SupportedProviderId } from "@worldbuilding-agent/core";

let mainWindow: BrowserWindow | null = null;
let server: Awaited<ReturnType<typeof createServer>> | null = null;

const settingsStore = new Store<{ settings?: AppSettings }>({
  name: "settings",
});

function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

function maskSettings(settings: AppSettings | undefined): AppSettings | null {
  if (!settings) return null;
  const masked: AppSettings = { providers: {}, defaultModel: settings.defaultModel };
  for (const [id, config] of Object.entries(settings.providers)) {
    if (config?.apiKey) {
      (masked.providers as any)[id] = { apiKey: maskApiKey(config.apiKey) };
    }
  }
  return masked;
}

function restoreEnvFromSettings(): void {
  const settings = settingsStore.get("settings");
  if (!settings) return;
  for (const [id, config] of Object.entries(settings.providers)) {
    if (config?.apiKey) {
      const provider = SUPPORTED_PROVIDERS[id as SupportedProviderId];
      if (provider) {
        process.env[provider.envKey] = config.apiKey;
      }
    }
  }
}

async function startServer(projectRoot: string): Promise<number> {
  server = await createServer(projectRoot);
  const address = server.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return port;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  mainWindow.webContents.openDevTools();
}

ipcMain.handle("select-directory", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("start-server", async (_event, projectRoot: string) => {
  return startServer(projectRoot);
});

ipcMain.handle("get-settings", () => {
  const settings = settingsStore.get("settings");
  return maskSettings(settings);
});

ipcMain.handle("save-settings", (_event, settings: AppSettings) => {
  const prev = settingsStore.get("settings");
  const merged: AppSettings = { providers: {}, defaultModel: settings.defaultModel };
  for (const id of Object.keys(SUPPORTED_PROVIDERS) as SupportedProviderId[]) {
    const newConfig = settings.providers[id];
    const prevConfig = prev?.providers?.[id as keyof typeof prev.providers];
    if (newConfig?.apiKey && !newConfig.apiKey.includes("****")) {
      (merged.providers as any)[id] = { apiKey: newConfig.apiKey };
    } else if (prevConfig?.apiKey) {
      (merged.providers as any)[id] = { apiKey: prevConfig.apiKey };
    }
  }
  settingsStore.set("settings", merged);
  for (const [id, config] of Object.entries(merged.providers)) {
    if (config?.apiKey) {
      const provider = SUPPORTED_PROVIDERS[id as SupportedProviderId];
      if (provider) {
        process.env[provider.envKey] = config.apiKey;
      }
    }
  }
  return { success: true };
});

ipcMain.handle("get-supported-providers", () => {
  return SUPPORTED_PROVIDERS;
});

app.whenReady().then(() => {
  restoreEnvFromSettings();
  createWindow();
});

app.on("window-all-closed", () => {
  if (server) {
    server.close();
    server = null;
  }
  app.quit();
});
