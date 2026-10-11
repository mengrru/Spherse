import type { BrowserWindow } from "electron";
import { registerProjectIpc } from "./project.js";
import { registerHostPrefsIpc } from "./host-prefs.js";
import { registerDebugIpc } from "./debug.js";
import { registerSkillIpc } from "./skill.js";
import { registerUpdaterIpc } from "./updater.js";
import { registerMobileAccessIpc } from "./mobile.js";

export function registerAllIpc(getWindow: () => BrowserWindow | null): void {
  registerProjectIpc(getWindow);
  registerHostPrefsIpc();
  registerDebugIpc(getWindow);
  registerSkillIpc(getWindow);
  registerUpdaterIpc(getWindow);
  registerMobileAccessIpc(getWindow);
}
