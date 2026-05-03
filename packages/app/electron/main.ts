import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import { createServer } from "@worldbuilding-agent/server";

let mainWindow: BrowserWindow | null = null;
let server: Awaited<ReturnType<typeof createServer>> | null = null;

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

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (server) {
    server.close();
    server = null;
  }
  app.quit();
});
