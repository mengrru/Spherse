import type {
  HostBridge,
  HostCapabilities,
  HostSettings,
} from "@spherse/app/src/lib/host-bridge";

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

export function createWebHostBridge(): HostBridge {
  return {
    kind: "web",
    capabilities: WEB_CAPABILITIES,
    getServerBaseUrl: async () => {
      const conn = readConnection();
      if (!conn?.baseUrl) {
        throw new Error("No server connection configured. Scan a QR code first.");
      }
      return conn.baseUrl;
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
  };
}
