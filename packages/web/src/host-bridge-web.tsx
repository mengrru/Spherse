import type {
  HostBridge,
  HostCapabilities,
  HostSettings,
  ProjectHostApi,
  RestoredProject,
  SampleManifestEntry,
} from "@spherse/app/src/lib/host-bridge";
import { MobileConnectPage } from "./pages/MobileConnectPage";

const WEB_CAPABILITIES: HostCapabilities = {
  projectManagement: false,
  filePicker: false,
  appUpdate: false,
  devTools: false,
  mobileAccess: false,
  settings: { editable: true, scope: "local-only" },
  content: { editable: false },
};

const SETTINGS_STORAGE_KEY = "spherse:settings";
const CONNECTION_STORAGE_KEY = "spherse:connection";
const LAST_ACTIVE_PROJECT_KEY = "spherse:last-active-project";

const PLACEHOLDER_LAST_OPENED = new Date(0).toISOString();

async function loadSettings(): Promise<HostSettings | null> {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as HostSettings) : null;
  } catch {
    return null;
  }
}

async function persistSettings(settings: HostSettings): Promise<{ success: boolean }> {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return { success: true };
  } catch {
    return { success: false };
  }
}

function readConnection(): { baseUrl?: string; token?: string } | null {
  try {
    const raw = localStorage.getItem(CONNECTION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as { baseUrl?: string; token?: string }) : null;
  } catch {
    return null;
  }
}

function createWebProjectApi(
  getBaseUrl: () => Promise<string>,
  getToken: () => Promise<string | null>,
): ProjectHostApi {
  async function fetchJson<T>(path: string): Promise<T> {
    const baseUrl = await getBaseUrl();
    const token = await getToken();
    const url = new URL(`${baseUrl}${path}`);
    if (token) url.searchParams.set("token", token);
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  }

  return {
    async selectDirectory() {
      return null;
    },
    async selectSkillZip() {
      return null;
    },
    async openProject() {
      throw new Error("openProject is not supported on web");
    },
    async restoreProjects() {
      const entries = await fetchJson<Array<{ id: string; name: string }>>("/api/projects");
      if (entries.length === 0) return [];
      const infos = await Promise.allSettled(
        entries.map((entry) =>
          fetchJson<{ id: string; name: string; rootPath: string }>(
            `/api/projects/${encodeURIComponent(entry.id)}/info`,
          ),
        ),
      );
      const restored: RestoredProject[] = [];
      infos.forEach((result, index) => {
        if (result.status === "fulfilled") {
          const info = result.value;
          restored.push({
            id: info.id,
            path: info.rootPath,
            name: info.name,
            lastOpened: PLACEHOLDER_LAST_OPENED,
          });
        } else {
          const entry = entries[index];
          restored.push({
            id: entry.id,
            path: "",
            name: entry.name,
            lastOpened: PLACEHOLDER_LAST_OPENED,
          });
        }
      });
      return restored;
    },
    async addOpenProject() {
      void 0;
    },
    async closeProject() {
      void 0;
    },
    async openProjectFolder() {
      void 0;
    },
    async setLastActiveProject(projectId) {
      try {
        localStorage.setItem(LAST_ACTIVE_PROJECT_KEY, projectId);
      } catch {
        void 0;
      }
    },
    async getLastActiveProject() {
      try {
        return localStorage.getItem(LAST_ACTIVE_PROJECT_KEY);
      } catch {
        return null;
      }
    },
    async openSampleProject() {
      return null;
    },
    async getSampleManifest(): Promise<SampleManifestEntry[]> {
      return [];
    },
  };
}

export function createWebHostBridge(): HostBridge {
  const bridge: HostBridge = {
    kind: "web",
    capabilities: WEB_CAPABILITIES,
    getServerBaseUrl: async () => {
      const conn = readConnection();
      return conn?.baseUrl ?? "";
    },
    getServerAccessToken: async () => {
      const conn = readConnection();
      return conn?.token ?? null;
    },
    getSettings: loadSettings,
    saveSettings: persistSettings,
    openExternal: async (url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    saveBlob: async (filename: string, blob: Blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    project: createWebProjectApi(
      () => bridge.getServerBaseUrl(),
      () => bridge.getServerAccessToken?.() ?? Promise.resolve(null),
    ),
    renderConnectPage: () => <MobileConnectPage />,
  };
  return bridge;
}
