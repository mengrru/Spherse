# Settings Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global settings system allowing users to configure API keys for DeepSeek and z.ai providers and select a default model, accessible via a settings button in the sidebar.

**Architecture:** Settings are stored globally via `electron-store` in the Electron main process. API keys are injected into `process.env` so pi-ai picks them up automatically. The server exposes a provider list endpoint; the React frontend uses Electron IPC for settings CRUD and HTTP for the model catalog.

**Tech Stack:** electron-store, TypeScript, React, Fastify

---

### Task 1: Add AppSettings types and SUPPORTED_PROVIDERS to core

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: Add types to types.ts**

Append the following to `packages/core/src/types.ts` after the existing `SessionInfo` interface:

```typescript
export interface AppSettings {
  providers: {
    deepseek?: { apiKey: string };
    zai?: { apiKey: string };
  };
  defaultModel: string;
}

export const SUPPORTED_PROVIDERS = {
  deepseek: {
    name: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  },
  zai: {
    name: "z.ai",
    envKey: "ZAI_API_KEY",
    models: ["glm-4.5-air", "glm-4.7", "glm-5-turbo", "glm-5.1", "glm-5v-turbo"],
  },
} as const;

export type SupportedProviderId = keyof typeof SUPPORTED_PROVIDERS;
```

- [ ] **Step 2: Verify types compile**

Run: `npm run build --workspace=packages/core`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat: add AppSettings type and SUPPORTED_PROVIDERS constant"
```

---

### Task 2: Export new types from core index

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add exports**

The file already has `export * from "./types.js";` so `AppSettings`, `SUPPORTED_PROVIDERS`, and `SupportedProviderId` are automatically exported. No changes needed to this file.

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace=packages/core`
Expected: Build succeeds.

---

### Task 3: Extend resolveModel() in agent-engine

**Files:**
- Modify: `packages/core/src/agent-engine.ts`

- [ ] **Step 1: Import SUPPORTED_PROVIDERS**

Add `SUPPORTED_PROVIDERS` to the import from `./types.js`. Change line 5:

```typescript
import type { AgentDefinition } from "./types.js";
```

to:

```typescript
import type { AgentDefinition } from "./types.js";
import { SUPPORTED_PROVIDERS } from "./types.js";
```

- [ ] **Step 2: Update resolveModel()**

Replace the `resolveModel` method (lines 146-156) with:

```typescript
  private resolveModel(modelId: string): any {
    const providers: string[] = [
      ...Object.keys(SUPPORTED_PROVIDERS),
      "google",
      "anthropic",
      "openai",
    ];
    for (const provider of providers) {
      try {
        return (getModel as any)(provider, modelId);
      } catch {
        continue;
      }
    }
    throw new Error(`Could not resolve model: ${modelId}`);
  }
```

- [ ] **Step 3: Verify build**

Run: `npm run build --workspace=packages/core`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/agent-engine.ts
git commit -m "feat: extend resolveModel to include deepseek and zai providers"
```

---

### Task 4: Add provider list route to server

**Files:**
- Modify: `packages/server/src/routes.ts`

- [ ] **Step 1: Add import and route**

Add `SUPPORTED_PROVIDERS` to the import at the top. Change line 4:

```typescript
import type { AppContext } from "./index.js";
```

to:

```typescript
import type { AppContext } from "./index.js";
import { SUPPORTED_PROVIDERS } from "@worldbuilding-agent/core";
```

Then add a new route inside `registerRoutes()`, after the last existing route (after the `/api/content/*` handler, before the closing `}`):

```typescript
  fastify.get("/api/settings/providers", async () => {
    return SUPPORTED_PROVIDERS;
  });
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace=packages/server`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes.ts
git commit -m "feat: add GET /api/settings/providers route"
```

---

### Task 5: Install electron-store in app package

**Files:**
- Modify: `packages/app/package.json`

- [ ] **Step 1: Install electron-store**

Run: `npm install electron-store --save --workspace=packages/app`

- [ ] **Step 2: Verify installation**

Run: `ls node_modules/electron-store/index.js`
Expected: File exists.

- [ ] **Step 3: Commit**

```bash
git add packages/app/package.json package-lock.json
git commit -m "chore: add electron-store dependency"
```

---

### Task 6: Add settings IPC handlers in Electron main process

**Files:**
- Modify: `packages/app/electron/main.ts`

- [ ] **Step 1: Add imports**

Add after line 3 (`import { createServer } from "@worldbuilding-agent/server";`):

```typescript
import Store from "electron-store";
import type { AppSettings } from "@worldbuilding-agent/core";
import { SUPPORTED_PROVIDERS, type SupportedProviderId } from "@worldbuilding-agent/core";
```

- [ ] **Step 2: Create store instance**

Add after line 6 (`let server: ... | null = null;`):

```typescript
const settingsStore = new Store<{ settings?: AppSettings }>({
  name: "settings",
});
```

- [ ] **Step 3: Add maskApiKey helper**

Add after the `settingsStore` declaration:

```typescript
function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

function maskSettings(settings: AppSettings | undefined): AppSettings | null {
  if (!settings) return null;
  const masked: AppSettings = { providers: {}, defaultModel: settings.defaultModel };
  for (const [id, config] of Object.entries(settings.providers)) {
    if (config?.apiKey) {
      (masked.providers as any)[id] = { apiKey: maskApiKey(config.apiKey) };
    }
  }
  return masked;
}

function restoreEnvFromSettings(): void {
  const settings = settingsStore.get("settings");
  if (!settings) return;
  for (const [id, config] of Object.entries(settings.providers)) {
    if (config?.apiKey) {
      const provider = SUPPORTED_PROVIDERS[id as SupportedProviderId];
      if (provider) {
        process.env[provider.envKey] = config.apiKey;
      }
    }
  }
}
```

- [ ] **Step 4: Add IPC handlers**

Add after the existing `ipcMain.handle("start-server", ...)` block (after line 44):

```typescript
ipcMain.handle("get-settings", () => {
  const settings = settingsStore.get("settings");
  return maskSettings(settings);
});

ipcMain.handle("save-settings", (_event, settings: AppSettings) => {
  const prev = settingsStore.get("settings");
  const merged: AppSettings = { providers: {}, defaultModel: settings.defaultModel };
  for (const id of Object.keys(SUPPORTED_PROVIDERS) as SupportedProviderId[]) {
    const newConfig = settings.providers[id];
    const prevConfig = prev?.providers?.[id as keyof typeof prev.providers];
    if (newConfig?.apiKey && !newConfig.apiKey.includes("****")) {
      (merged.providers as any)[id] = { apiKey: newConfig.apiKey };
    } else if (prevConfig?.apiKey) {
      (merged.providers as any)[id] = { apiKey: prevConfig.apiKey };
    }
  }
  settingsStore.set("settings", merged);
  for (const [id, config] of Object.entries(merged.providers)) {
    if (config?.apiKey) {
      const provider = SUPPORTED_PROVIDERS[id as SupportedProviderId];
      if (provider) {
        process.env[provider.envKey] = config.apiKey;
      }
    }
  }
  return { success: true };
});

ipcMain.handle("get-supported-providers", () => {
  return SUPPORTED_PROVIDERS;
});
```

- [ ] **Step 5: Restore env on startup**

Change line 46:

```typescript
app.whenReady().then(createWindow);
```

to:

```typescript
app.whenReady().then(() => {
  restoreEnvFromSettings();
  createWindow();
});
```

- [ ] **Step 6: Verify build**

Run: `npm run build --workspace=packages/app`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/app/electron/main.ts
git commit -m "feat: add settings IPC handlers with electron-store"
```

---

### Task 7: Add settings APIs to preload script

**Files:**
- Modify: `packages/app/electron/preload.ts`

- [ ] **Step 1: Add settings methods**

Replace the entire file content with:

```typescript
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  startServer: (projectRoot: string) =>
    ipcRenderer.invoke("start-server", projectRoot),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings: unknown) =>
    ipcRenderer.invoke("save-settings", settings),
  getSupportedProviders: () =>
    ipcRenderer.invoke("get-supported-providers"),
});
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace=packages/app`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/app/electron/preload.ts
git commit -m "feat: expose settings IPC methods in preload"
```

---

### Task 8: Add getSupportedProviders to ApiClient

**Files:**
- Modify: `packages/app/src/lib/api.ts`

- [ ] **Step 1: Add method**

Add after the `createAgent` method (after line 72) and before `createChatWebSocket`:

```typescript
    async getSupportedProviders(): Promise<Record<string, {
      name: string;
      envKey: string;
      models: readonly string[];
    }>> {
      const res = await fetch(`${baseUrl}/api/settings/providers`);
      return res.json();
    },
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace=packages/app`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/lib/api.ts
git commit -m "feat: add getSupportedProviders to ApiClient"
```

---

### Task 9: Create SettingsModal component

**Files:**
- Create: `packages/app/src/components/SettingsModal.tsx`

- [ ] **Step 1: Create the component**

Create `packages/app/src/components/SettingsModal.tsx` with the following content:

```tsx
import { useState, useEffect } from "react";

interface ProviderConfig {
  name: string;
  envKey: string;
  models: readonly string[];
}

type ProviderSettings = Record<string, { apiKey: string } | undefined>;

interface SettingsModalProps {
  onClose: () => void;
}

const electronAPI = (window as any).electronAPI as {
  getSettings: () => Promise<any>;
  saveSettings: (settings: any) => Promise<{ success: boolean }>;
  getSupportedProviders: () => Promise<Record<string, ProviderConfig>>;
};

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [defaultModel, setDefaultModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      electronAPI.getSupportedProviders(),
      electronAPI.getSettings(),
    ]).then(([prov, settings]) => {
      setProviders(prov ?? {});
      if (settings) {
        const keys: Record<string, string> = {};
        for (const [id, config] of Object.entries(settings.providers ?? {})) {
          if ((config as any)?.apiKey) {
            keys[id] = (config as any).apiKey;
          }
        }
        setApiKeys(keys);
        setDefaultModel(settings.defaultModel ?? "");
      }
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    const providersSettings: ProviderSettings = {};
    for (const [id, key] of Object.entries(apiKeys)) {
      if (key.trim()) {
        providersSettings[id] = { apiKey: key.trim() };
      }
    }
    try {
      await electronAPI.saveSettings({
        providers: providersSettings,
        defaultModel,
      });
      setMessage("saved");
    } catch {
      setMessage("error");
    }
    setSaving(false);
  };

  const availableModels = Object.entries(providers)
    .filter(([id]) => apiKeys[id]?.trim())
    .flatMap(([_id, config]) =>
      config.models.map((m) => ({ provider: config.name, model: m }))
    );

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>设置</h2>
          <button className="dialog-close" onClick={onClose}>✕</button>
        </div>
        <div className="dialog-body">
          <div className="settings-section">
            <h3 className="settings-section-title">API 配置</h3>
            {Object.entries(providers).map(([id, config]) => (
              <div key={id} className="settings-provider-row">
                <div className="settings-provider-info">
                  <span className="settings-provider-name">{config.name}</span>
                  <span
                    className={`settings-status-dot ${apiKeys[id]?.trim() ? "settings-status-ok" : "settings-status-none"}`}
                  />
                </div>
                <div className="settings-key-input-wrap">
                  <input
                    type={showKeys[id] ? "text" : "password"}
                    className="settings-key-input"
                    placeholder={config.envKey}
                    value={apiKeys[id] ?? ""}
                    onChange={(e) =>
                      setApiKeys({ ...apiKeys, [id]: e.target.value })
                    }
                  />
                  <button
                    className="settings-toggle-key"
                    onClick={() =>
                      setShowKeys({ ...showKeys, [id]: !showKeys[id] })
                    }
                  >
                    {showKeys[id] ? "隐藏" : "显示"}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="settings-section">
            <h3 className="settings-section-title">默认模型</h3>
            <select
              className="settings-model-select"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
            >
              <option value="">-- 请选择 --</option>
              {Object.entries(providers)
                .filter(([id]) => apiKeys[id]?.trim())
                .map(([id, config]) => (
                  <optgroup key={id} label={config.name}>
                    {config.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </optgroup>
                ))}
            </select>
            {availableModels.length === 0 && (
              <p className="settings-hint">请先配置 API Key</p>
            )}
          </div>
        </div>
        <div className="dialog-footer">
          {message === "saved" && (
            <span className="settings-save-ok">已保存</span>
          )}
          {message === "error" && (
            <span className="settings-save-error">保存失败</span>
          )}
          <button className="dialog-btn-cancel" onClick={onClose}>
            关闭
          </button>
          <button
            className="dialog-btn-submit"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace=packages/app`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/components/SettingsModal.tsx
git commit -m "feat: add SettingsModal component"
```

---

### Task 10: Add SettingsModal styles

**Files:**
- Modify: `packages/app/src/styles.css`

- [ ] **Step 1: Append styles**

Add the following CSS at the end of `packages/app/src/styles.css`:

```css
.sidebar-footer {
  margin-top: auto;
  padding: 12px;
  border-top: 1px solid #f0f0f0;
}

.settings-btn {
  width: 100%;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 6px;
  font-size: 13px;
  color: #666;
  text-align: center;
  transition: background 0.15s;
}

.settings-btn:hover {
  background: #e8e8e8;
  color: #333;
}

.settings-dialog {
  width: 480px;
}

.settings-section {
  margin-bottom: 20px;
}

.settings-section:last-child {
  margin-bottom: 0;
}

.settings-section-title {
  font-size: 13px;
  font-weight: 600;
  color: #555;
  margin-bottom: 10px;
}

.settings-provider-row {
  margin-bottom: 12px;
}

.settings-provider-info {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.settings-provider-name {
  font-size: 13px;
  font-weight: 500;
}

.settings-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.settings-status-ok {
  background: #4caf50;
}

.settings-status-none {
  background: #e0e0e0;
}

.settings-key-input-wrap {
  display: flex;
  gap: 6px;
}

.settings-key-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 5px;
  outline: none;
  font-size: 13px;
}

.settings-key-input:focus {
  border-color: #4a90d9;
}

.settings-toggle-key {
  padding: 6px 10px;
  background: #f0f0f0;
  border-radius: 5px;
  font-size: 12px;
  color: #666;
  white-space: nowrap;
}

.settings-toggle-key:hover {
  background: #e0e0e0;
}

.settings-model-select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 5px;
  font-size: 13px;
  outline: none;
  background: white;
}

.settings-model-select:focus {
  border-color: #4a90d9;
}

.settings-hint {
  font-size: 12px;
  color: #999;
  margin-top: 6px;
}

.settings-save-ok {
  color: #4caf50;
  font-size: 13px;
  margin-right: auto;
}

.settings-save-error {
  color: #e74c3c;
  font-size: 13px;
  margin-right: auto;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace=packages/app`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/styles.css
git commit -m "feat: add settings modal and sidebar button styles"
```

---

### Task 11: Integrate settings button into ProjectPage

**Files:**
- Modify: `packages/app/src/pages/ProjectPage.tsx`

- [ ] **Step 1: Add import and state**

Add `SettingsModal` to the imports. After line 6 (`import { ChatPage } from "./ChatPage";`):

```typescript
import { SettingsModal } from "../components/SettingsModal";
```

Add state inside the component, after `const [showCreateAgent, setShowCreateAgent] = useState(false);` (line 22):

```typescript
  const [showSettings, setShowSettings] = useState(false);
```

- [ ] **Step 2: Add settings button to sidebar**

Inside the `<aside className="sidebar">` element, after the FileTree sidebar-section `</div>` (after line 77) and before the closing `</aside>` (line 78), add:

```tsx
        <div className="sidebar-footer">
          <button className="settings-btn" onClick={() => setShowSettings(true)}>
            ⚙ 设置
          </button>
        </div>
```

- [ ] **Step 3: Add SettingsModal rendering**

After the `showCreateAgent` block (after line 99 `)}` and before the closing `</div>` of project-page on line 100), add:

```tsx
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
```

- [ ] **Step 4: Verify build**

Run: `npm run build --workspace=packages/app`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/pages/ProjectPage.tsx
git commit -m "feat: add settings button to sidebar and integrate SettingsModal"
```

---

### Task 12: Verify full build

- [ ] **Step 1: Build all packages**

Run: `npm run build`
Expected: All three packages build successfully.

- [ ] **Step 2: Run core verification**

Run: `node scripts/verify.mjs`
Expected: All tests pass (same as before — no tests were broken).
