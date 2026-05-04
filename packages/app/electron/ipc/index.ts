import type { BrowserWindow } from "electron";
import { registerProjectIpc } from "./project.js";
import { registerSettingsIpc } from "./settings.js";

export function registerAllIpc(getWindow: () => BrowserWindow | null): void {
  registerProjectIpc(getWindow);
  registerSettingsIpc();
}
