import type { ProviderCatalogItem } from "@spherse/core";

export interface RestoredProject {
  id: string;
  path: string;
  name: string;
  lastRoute?: string;
}

export interface SaveDialogOptions {
  defaultPath?: string;
}

export interface IpcAppSettings {
  providers?: Record<string, { apiKey?: string } | undefined>;
  defaultModel?: string;
  locale?: string;
}

export interface ElectronAPI {
  selectDirectory: () => Promise<string | null>;
  openProject: (projectRoot: string) => Promise<{ projectId: string }>;
  getServerPort: () => Promise<number>;
  restoreProjects: () => Promise<RestoredProject[]>;
  addOpenProject: (projectId: string, projectRoot: string) => Promise<void>;
  closeProject: (projectId: string) => Promise<void>;
  revealInFinder: (projectRoot: string) => Promise<void>;
  setLastActiveProject: (projectId: string) => Promise<void>;
  getLastActiveProject: () => Promise<string | null>;
  setProjectLastRoute: (projectId: string, route: string) => Promise<void>;
  getSettings: () => Promise<IpcAppSettings | null>;
  saveSettings: (settings: IpcAppSettings) => Promise<{ success: boolean }>;
  getSupportedProviders: () => Promise<Record<string, ProviderCatalogItem>>;
  isDev: () => Promise<boolean>;
  toggleDevTools: () => Promise<void>;
  isDevToolsOpen: () => Promise<boolean>;
  getElectronStoreData: () => Promise<Record<string, unknown>>;
  reloadRenderer: () => Promise<void>;
  resetAppData: () => Promise<void>;
  showSaveDialog: (options: SaveDialogOptions) => Promise<string | null>;
}
