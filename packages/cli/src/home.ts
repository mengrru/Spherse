import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function resolveHome(flag?: string): string {
  const raw = flag ?? process.env.SPHERSE_HOME ?? join(homedir(), ".spherse");
  return resolve(raw);
}

export interface HomePaths {
  home: string;
  settingsPath: string;
  modelSettingsPath: string;
  projectsDir: string;
  lockfilePath: string;
}

export function homePaths(home: string): HomePaths {
  return {
    home,
    settingsPath: join(home, "settings.json"),
    modelSettingsPath: join(home, "model-settings.json"),
    projectsDir: join(home, "projects"),
    lockfilePath: join(home, "server.lock"),
  };
}

export function initHome(paths: HomePaths): void {
  mkdirSync(paths.projectsDir, { recursive: true });
}
