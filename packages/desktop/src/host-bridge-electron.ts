import type {
  HostBridge,
  HostCapabilities,
  ProjectHostApi,
  UpdaterHostApi,
  DevToolsHostApi,
  MobileAccessHostApi,
} from "@spherse/app/host-bridge";

const ELECTRON_CAPABILITIES: HostCapabilities = {
  filePicker: true,
  mobileAccess: true,
  openFileExternal: true,
  content: { editable: true },
};

export function createElectronHostBridge(): HostBridge {
  const api = window.electronAPI;

  const project: ProjectHostApi = {
    selectDirectory: api.selectDirectory,
    selectSkillZip: api.selectSkillZip,
    openProject: api.openProject,
    restoreProjects: api.restoreProjects,
    addOpenProject: api.addOpenProject,
    closeProject: api.closeProject,
    openProjectFolder: api.openProjectFolder,
    openFileExternal: api.openFile,
    downloadFile: api.downloadFile,
    setLastActiveProject: api.setLastActiveProject,
    getLastActiveProject: api.getLastActiveProject,
  };

  const updater: UpdaterHostApi = {
    checkForUpdates: api.checkForUpdates,
    downloadUpdate: api.downloadUpdate,
    installUpdate: api.installUpdate,
    cancelUpdate: api.cancelUpdate,
    getUpdateState: api.getUpdateState,
    getAppVersion: api.getAppVersion,
    onUpdateEvent: api.onUpdateEvent,
  };

  const devTools: DevToolsHostApi = {
    isDev: api.isDev,
    toggleDevTools: api.toggleDevTools,
    isDevToolsOpen: api.isDevToolsOpen,
    getElectronStoreData: api.getElectronStoreData,
    reloadRenderer: api.reloadRenderer,
    resetAppData: api.resetAppData,
  };

  const mobile: MobileAccessHostApi = {
    getMobileAccessState: api.getMobileAccessState,
    enableMobileAccess: api.enableMobileAccess,
    disableMobileAccess: api.disableMobileAccess,
    regenerateToken: api.regenerateToken,
    restartTunnel: api.restartTunnel,
    setMobileMode: api.setMobileMode,
    setPublicDomain: api.setPublicDomain,
    onMobileAccessEvent: api.onMobileAccessEvent,
  };

  return {
    kind: "electron",
    capabilities: ELECTRON_CAPABILITIES,
    getServerBaseUrl: async () => {
      const port = await api.getServerPort();
      return `http://localhost:${port}`;
    },
    getServerAccessToken: async () => {
      const state = await api.getMobileAccessState();
      return state.token;
    },
    getAppVersion: api.getAppVersion,
    prefs: {
      getPrefs: api.getGeneralPrefs,
      savePrefs: async (prefs) => {
        const res = await api.saveGeneralPrefs(prefs);
        return res.success;
      },
    },
    desktopPrefs: {
      getPrefs: api.getDesktopPrefs,
      savePrefs: async (prefs) => {
        const res = await api.saveDesktopPrefs(prefs);
        return res.success;
      },
    },
    openExternal: api.openExternal,
    showSaveDialog: api.showSaveDialog,
    project,
    updater,
    devTools,
    mobile,
  };
}
