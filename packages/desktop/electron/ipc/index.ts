import type { BrowserWindow } from "electron";
import { registerProjectIpc } from "./project.js";
import { registerSettingsIpc } from "./settings.js";
import { registerDebugIpc } from "./debug.js";
import { registerSkillIpc } from "./skill.js";
import { registerUpdaterIpc } from "./updater.js";

export function registerAllIpc(getWindow: () => BrowserWindow | null): void {
  registerProjectIpc(getWindow);
  registerSettingsIpc();
  registerDebugIpc(getWindow);
  registerSkillIpc(getWindow);
  registerUpdaterIpc(getWindow);
}
