import type {
  HostBridge,
  HostPrefsApi,
  ProjectHostApi,
  RestoredProject,
} from "@spherse/app/host-bridge";
import { getSharedRpcClient, isLocalRuntimeBaseUrl } from "@spherse/app/lib/rpc/shared";
import { RpcSharedWorkerTransport } from "./client/runtime-transport";
import { LocalOnboarding } from "./onboarding";

declare const __SPHERSE_BROWSER_VERSION__: string;

const BROWSER_CAPABILITIES = {
  filePicker: false,
  mobileAccess: false,
  openFileExternal: false,
  content: { editable: true },
} as const;

const PREFS_STORAGE_KEY = "spherse:prefs";
const LAST_ACTIVE_PROJECT_KEY = "spherse:last-active-project";
const PLACEHOLDER_LAST_OPENED = new Date(0).toISOString();

interface ProjectListEntry {
  id: string;
  name: string;
  lastOpened?: string;
}

interface ProjectInfo {
  id: string;
  name: string;
  rootPath: string;
  lastOpened?: string;
}

export function createBrowserHostBridge(): HostBridge {
  const client = getSharedRpcClient(window.location.origin, () => null);

  const projectApi: ProjectHostApi = {
    async selectDirectory() {
      return null;
    },
    async selectSkillZip() {
      return null;
    },
    async openProject(name: string) {
      const result = await client.call<{ projectId: string }>("browser.createProject", { name });
      return { projectId: result.projectId };
    },
    async restoreProjects() {
      const entries = await client.call<ProjectListEntry[]>("connection.projects", {});
      if (entries.length === 0) return [];
      const infos = await Promise.allSettled(
        entries.map((entry) =>
          client.call<ProjectInfo>("connection.projectInfo", { projectId: entry.id }),
        ),
      );
      const restored: RestoredProject[] = [];
      infos.forEach((result, index) => {
        if (result.status === "fulfilled") {
          restored.push({
            id: result.value.id,
            path: result.value.rootPath,
            name: result.value.name,
            lastOpened: entries[index].lastOpened ?? result.value.lastOpened ?? PLACEHOLDER_LAST_OPENED,
          });
        }
      });
      return restored;
    },
    async addOpenProject() {},
    async closeProject() {},
    async openProjectFolder() {},
    async openFileExternal() {},
    async downloadFile() {},
    async setLastActiveProject(id: string | null) {
      if (id === null) localStorage.removeItem(LAST_ACTIVE_PROJECT_KEY);
      else localStorage.setItem(LAST_ACTIVE_PROJECT_KEY, id);
    },
    async getLastActiveProject() {
      return localStorage.getItem(LAST_ACTIVE_PROJECT_KEY);
    },
  };

  const prefsApi: HostPrefsApi = {
    async getPrefs() {
      try {
        const raw = localStorage.getItem(PREFS_STORAGE_KEY);
        const stored = raw ? (JSON.parse(raw) as { locale?: string; tabsEnabled?: boolean }) : null;
        return { locale: stored?.locale ?? "zh-CN", tabsEnabled: stored?.tabsEnabled ?? true };
      } catch {
        return { locale: "zh-CN", tabsEnabled: true };
      }
    },
    async savePrefs(prefs) {
      try {
        const raw = localStorage.getItem(PREFS_STORAGE_KEY);
        const current = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ ...current, ...prefs }));
        return true;
      } catch {
        return false;
      }
    },
  };

  return {
    kind: "web",
    getServerBaseUrl: async () => window.location.origin,
    getServerAccessToken: async () => null,
    clearConnection: async () => {},
    getAppVersion: async () => __SPHERSE_BROWSER_VERSION__,
    capabilities: BROWSER_CAPABILITIES,
    prefs: prefsApi,
    openExternal: async (url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    saveBlob: async (filename: string, blob: Blob) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },
    project: projectApi,
    renderConnectPage: () => <LocalOnboarding />,
  };
}

export function setupBrowserRuntime(): void {
  if (!isLocalRuntimeBaseUrl(window.location.origin)) {
    throw new Error("browser runtime expects same-origin base url");
  }
  void new RpcSharedWorkerTransport();
}
