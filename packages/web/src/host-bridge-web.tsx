import type {
  HostBridge,
  HostCapabilities,
  HostPrefsApi,
  ProjectHostApi,
  RestoredProject,
} from "@spherse/app/host-bridge";
import { MobileConnectPage } from "./pages/MobileConnectPage";

const WEB_CAPABILITIES: HostCapabilities = {
  filePicker: false,
  mobileAccess: false,
  openFileExternal: false,
  content: { editable: true },
};

const IS_DEV_DEPLOY =
  window.location.pathname.startsWith("/dev/web/") || window.location.pathname === "/dev/web";

function scopedStorageKey(key: string): string {
  return IS_DEV_DEPLOY ? `${key}:dev` : key;
}

const PREFS_STORAGE_KEY = scopedStorageKey("spherse:prefs");
const LEGACY_SETTINGS_STORAGE_KEY = scopedStorageKey("spherse:settings");
export const WEB_CONNECTION_STORAGE_KEY = scopedStorageKey("spherse:connection");
const LAST_ACTIVE_PROJECT_KEY = scopedStorageKey("spherse:last-active-project");

const PLACEHOLDER_LAST_OPENED = new Date(0).toISOString();

function readStoredPrefs(): { locale?: string } | null {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as { locale?: string };
    const legacyRaw = localStorage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as { locale?: string };
      if (legacy.locale) {
        localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ locale: legacy.locale }));
      }
      localStorage.removeItem(LEGACY_SETTINGS_STORAGE_KEY);
      return { locale: legacy.locale };
    }
    return null;
  } catch {
    return null;
  }
}

function createWebPrefsApi(): HostPrefsApi {
  return {
    async getPrefs() {
      return { locale: readStoredPrefs()?.locale ?? "zh-CN" };
    },
    async savePrefs(prefs) {
      try {
        localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function readWebConnection(): { baseUrl?: string; token?: string } | null {
  try {
    const raw = localStorage.getItem(WEB_CONNECTION_STORAGE_KEY);
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const bodyHint = body.slice(0, 120).replace(/\s+/g, " ");
        throw new Error(`${path}: ${res.status} ${res.statusText}${bodyHint ? ` — ${bodyHint}` : ""}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`${path}: request timed out (10s)`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
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
      const entries = await fetchJson<Array<{ id: string; name: string; lastOpened?: string }>>("/api/projects");
      if (entries.length === 0) return [];
      const infos = await Promise.allSettled(
        entries.map((entry) =>
          fetchJson<{ id: string; name: string; rootPath: string; lastOpened?: string }>(
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
            lastOpened: info.lastOpened ?? PLACEHOLDER_LAST_OPENED,
          });
        } else {
          const entry = entries[index];
          restored.push({
            id: entry.id,
            path: "",
            name: entry.name,
            lastOpened: entry.lastOpened ?? PLACEHOLDER_LAST_OPENED,
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
    async openFileExternal() {
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
  };
}

export function createWebHostBridge(): HostBridge {
  const bridge: HostBridge = {
    kind: "web",
    capabilities: WEB_CAPABILITIES,
    getServerBaseUrl: async () => {
      const conn = readWebConnection();
      return conn?.baseUrl?.replace(/\/+$/, "") ?? "";
    },
    getServerAccessToken: async () => {
      const conn = readWebConnection();
      return conn?.token ?? null;
    },
    clearConnection: async () => {
      localStorage.removeItem(WEB_CONNECTION_STORAGE_KEY);
    },
    prefs: createWebPrefsApi(),
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
