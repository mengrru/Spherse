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
  debugToolsEnabled?: boolean;
}

export type UpdateStatus =
  | "idle" | "checking" | "upToDate"
  | "available" | "downloading" | "downloaded" | "error";

export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  releaseNotes?: string;
  downloadUrl?: string;
  percent?: number;
  errorMessage?: string;
  errorPhase?: "check" | "download";
}

export type UpdateEvent =
  | { type: "update-available"; version: string; releaseNotes: string; downloadUrl?: string }
  | { type: "update-not-available" }
  | { type: "download-progress"; percent: number }
  | { type: "update-downloaded" }
  | { type: "update-error"; message: string };

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
  openSampleProject: (opts: { sampleId: string }) => Promise<{ projectId: string; path: string } | { error: string } | null>;
  getSampleManifest: () => Promise<SampleManifestEntry[]>;
  checkForUpdates: (opts: { silent: boolean }) => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  cancelUpdate: () => Promise<void>;
  getUpdateState: () => Promise<UpdateState>;
  getAppVersion: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  onUpdateEvent: (callback: (event: UpdateEvent) => void) => () => void;
}
