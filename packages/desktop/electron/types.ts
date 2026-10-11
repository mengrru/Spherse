import type {
  DesktopPrefs,
  GeneralPrefs,
  MobileAccessEvent,
  MobileAccessState,
  MobileTunnelMode,
  RestoredProject,
  SaveDialogOptions,
  UpdateEvent,
  UpdateState,
} from "@spherse/app/host-bridge";

export type {
  DesktopPrefs,
  GeneralPrefs,
  MobileAccessEvent,
  MobileAccessState,
  MobileTunnelMode,
  RestoredProject,
  SaveDialogOptions,
  UpdateEvent,
  UpdateState,
};

export interface ElectronAPI {
  selectDirectory: () => Promise<string | null>;
  selectSkillZip: () => Promise<string | null>;
  openProject: (projectRoot: string) => Promise<{ projectId: string } | null>;
  getServerPort: () => Promise<number>;
  restoreProjects: () => Promise<RestoredProject[]>;
  addOpenProject: (projectId: string, projectRoot: string) => Promise<void>;
  closeProject: (projectId: string, projectPath: string) => Promise<void>;
  openProjectFolder: (projectRoot: string) => Promise<void>;
  openFile: (filePath: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  setLastActiveProject: (projectId: string) => Promise<void>;
  getLastActiveProject: () => Promise<string | null>;
  getGeneralPrefs: () => Promise<GeneralPrefs>;
  saveGeneralPrefs: (prefs: GeneralPrefs) => Promise<{ success: boolean }>;
  getDesktopPrefs: () => Promise<DesktopPrefs>;
  saveDesktopPrefs: (prefs: DesktopPrefs) => Promise<{ success: boolean }>;
  isDev: () => Promise<boolean>;
  toggleDevTools: () => Promise<void>;
  isDevToolsOpen: () => Promise<boolean>;
  getElectronStoreData: () => Promise<Record<string, unknown>>;
  reloadRenderer: () => Promise<void>;
  resetAppData: () => Promise<void>;
  showSaveDialog: (options: SaveDialogOptions) => Promise<string | null>;
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
