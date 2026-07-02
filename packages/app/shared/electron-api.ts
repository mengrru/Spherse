import type { ProviderCatalogItem, ModelGroupSettings } from "@spherse/core";

export interface RestoredProject {
  id: string;
  path: string;
  name: string;
  lastOpened: string;
}

export interface SaveDialogFilter {
  name: string;
  extensions: string[];
}

export interface SaveDialogOptions {
  defaultPath?: string;
  filters?: SaveDialogFilter[];
}

export interface SampleManifestEntry {
  id: string;
  displayName: string;
  dirName: string;
}

export interface IpcAppSettings {
  locale?: string;
  models?: {
    text?: ModelGroupSettings;
    image?: ModelGroupSettings;
  };
}

export interface ElectronAPI {
  selectDirectory: () => Promise<string | null>;
  selectSkillZip: () => Promise<string | null>;
  openProject: (projectRoot: string) => Promise<{ projectId: string }>;
  getServerPort: () => Promise<number>;
  restoreProjects: () => Promise<RestoredProject[]>;
  addOpenProject: (projectId: string, projectRoot: string) => Promise<void>;
  closeProject: (projectId: string, projectPath: string) => Promise<void>;
  openProjectFolder: (projectRoot: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  setLastActiveProject: (projectId: string) => Promise<void>;
  getLastActiveProject: () => Promise<string | null>;
  getSettings: () => Promise<IpcAppSettings | null>;
  saveSettings: (settings: IpcAppSettings) => Promise<{ success: boolean }>;
  getSupportedProviders: () => Promise<Record<string, ProviderCatalogItem>>;
  getImageProviders: () => Promise<Record<string, ProviderCatalogItem>>;
  isDev: () => Promise<boolean>;
  toggleDevTools: () => Promise<void>;
  isDevToolsOpen: () => Promise<boolean>;
  getElectronStoreData: () => Promise<Record<string, unknown>>;
  reloadRenderer: () => Promise<void>;
  resetAppData: () => Promise<void>;
  showSaveDialog: (options: SaveDialogOptions) => Promise<string | null>;
  createNewProject: () => Promise<{ projectId: string; path: string } | { error: string } | null>;
  openSampleProject: (opts: { sampleId: string }) => Promise<{ projectId: string; path: string } | { error: string } | null>;
  getSampleManifest: () => Promise<SampleManifestEntry[]>;
}
