import type { ProviderCatalogItem, ModelGroupSettings, CustomProviderDef } from "@spherse/core";

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

export type ThemeMode = "light" | "dark" | "system";

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

export type HostKind = "electron" | "web";

export interface HostSettings {
  locale?: string;
  models?: {
    text?: ModelGroupSettings;
    image?: ModelGroupSettings;
  };
  customProviders?: CustomProviderDef[];
  debugToolsEnabled?: boolean;
  theme?: ThemeMode;
}

export type TunnelStatus = "stopped" | "starting" | "running" | "error";

export interface MobileAccessState {
  enabled: boolean;
  token: string | null;
  tunnel: {
    status: TunnelStatus;
    publicUrl: string | null;
    startedAt: string | null;
    error: string | null;
  };
}

export type MobileAccessEvent = { type: "state"; state: MobileAccessState };

export interface MobileAccessHostApi {
  getMobileAccessState(): Promise<MobileAccessState>;
  enableMobileAccess(): Promise<MobileAccessState>;
  disableMobileAccess(): Promise<MobileAccessState>;
  regenerateToken(): Promise<MobileAccessState>;
  restartTunnel(): Promise<MobileAccessState>;
  onMobileAccessEvent(callback: (event: MobileAccessEvent) => void): () => void;
}

export interface HostCapabilities {
  projectManagement: boolean;
  filePicker: boolean;
  appUpdate: boolean;
  devTools: boolean;
  mobileAccess: boolean;
  settings: { editable: boolean; scope: "local-only" | "synced" };
  content: { editable: boolean };
}

export interface ProjectHostApi {
  selectDirectory(): Promise<string | null>;
  selectSkillZip(): Promise<string | null>;
  openProject(projectRoot: string): Promise<{ projectId: string }>;
  restoreProjects(): Promise<RestoredProject[]>;
  addOpenProject(projectId: string, projectRoot: string): Promise<void>;
  closeProject(projectId: string, projectPath: string): Promise<void>;
  openProjectFolder(projectRoot: string): Promise<void>;
  setLastActiveProject(projectId: string): Promise<void>;
  getLastActiveProject(): Promise<string | null>;
  openSampleProject(opts: { sampleId: string }): Promise<{ projectId: string; path: string } | { error: string } | null>;
  getSampleManifest(): Promise<SampleManifestEntry[]>;
}

export interface UpdaterHostApi {
  checkForUpdates(opts: { silent: boolean }): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  cancelUpdate(): Promise<void>;
  getUpdateState(): Promise<UpdateState>;
  getAppVersion(): Promise<string>;
  onUpdateEvent(callback: (event: UpdateEvent) => void): () => void;
}

export interface DevToolsHostApi {
  isDev(): Promise<boolean>;
  toggleDevTools(): Promise<void>;
  isDevToolsOpen(): Promise<boolean>;
  getElectronStoreData(): Promise<Record<string, unknown>>;
  reloadRenderer(): Promise<void>;
  resetAppData(): Promise<void>;
}

export interface HostBridge {
  readonly kind: HostKind;
  getServerBaseUrl(): Promise<string>;
  getServerAccessToken?(): Promise<string | null>;
  readonly capabilities: HostCapabilities;
  getSettings(): Promise<HostSettings | null>;
  saveSettings(settings: HostSettings): Promise<{ success: boolean }>;
  openExternal(url: string): Promise<void>;
  saveBlob?(filename: string, blob: Blob): Promise<void>;
  showSaveDialog?(options: SaveDialogOptions): Promise<string | null>;
  getSupportedProviders?(): Promise<Record<string, ProviderCatalogItem>>;
  getImageProviders?(): Promise<Record<string, ProviderCatalogItem>>;
  readonly project?: ProjectHostApi;
  readonly updater?: UpdaterHostApi;
  readonly devTools?: DevToolsHostApi;
  readonly mobile?: MobileAccessHostApi;
}
