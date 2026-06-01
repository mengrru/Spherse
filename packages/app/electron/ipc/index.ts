import type { BrowserWindow } from "electron";
import { registerProjectIpc } from "./project.js";
import { registerSettingsIpc } from "./settings.js";
import { registerDebugIpc } from "./debug.js";

export function registerAllIpc(getWindow: () => BrowserWindow | null): void {
  registerProjectIpc(getWindow);
  registerSettingsIpc();
  registerDebugIpc(getWindow);
}
