import type { ProviderCatalogItem } from "@spherse/core";
import type {
  HostSettings,
  MobileAccessEvent,
  MobileAccessState,
  MobileTunnelMode,
  RestoredProject,
  SaveDialogOptions,
  SampleManifestEntry,
  ThemeMode,
  UpdateEvent,
  UpdateState,
} from "@spherse/app/src/lib/host-bridge";

export type {
  MobileAccessEvent,
  MobileAccessState,
  MobileTunnelMode,
  RestoredProject,
  SaveDialogOptions,
  SampleManifestEntry,
  ThemeMode,
  UpdateEvent,
  UpdateState,
};

export interface ElectronAPI {
  selectDirectory: () => Promise<string | null>;
  selectSkillZip: () => Promise<string | null>;
  openProject: (projectRoot: string) => Promise<{ projectId: string }>;
  getServerPort: () => Promise<number>;
  restoreProjects: () => Promise<RestoredProject[]>;
  addOpenProject: (projectId: string, projectRoot: string) => Promise<void>;
  closeProject: (projectId: string, projectPath: string) => Promise<void>;
  openProjectFolder: (projectRoot: string) => Promise<void>;
  openFile: (filePath: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  setLastActiveProject: (projectId: string) => Promise<void>;
  getLastActiveProject: () => Promise<string | null>;
  getSettings: () => Promise<HostSettings | null>;
  saveSettings: (settings: HostSettings) => Promise<{ success: boolean }>;
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
  onUpdateEvent: (callback: (event: UpdateEvent) => void) => () => void;
  getMobileAccessState: () => Promise<MobileAccessState>;
  enableMobileAccess: (options?: { mode?: MobileTunnelMode; publicDomain?: string }) => Promise<MobileAccessState>;
  disableMobileAccess: () => Promise<MobileAccessState>;
  regenerateToken: () => Promise<MobileAccessState>;
  restartTunnel: () => Promise<MobileAccessState>;
  setMobileMode: (mode: MobileTunnelMode) => Promise<MobileAccessState>;
  setPublicDomain: (domain: string) => Promise<MobileAccessState>;
  onMobileAccessEvent: (callback: (event: MobileAccessEvent) => void) => () => void;
}
