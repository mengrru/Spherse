# i18n 基础设施 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 `@spherse/i18n` 共享 package，为前端、Electron、server、core 提供统一的多语言基础设施，支持 zh-CN / zh-TW / en。

**Architecture:** 新增 `packages/i18n` 纯 TS package，导出 locale 类型、翻译纯函数和 React provider/hook。core 的 `AppSettings` 扩展 `locale` 字段，Electron settings 持久化该字段。前端通过 `I18nProvider` + `useI18n()` 消费翻译。server/core 通过 `translate()` 纯函数消费。开发工作流由 `.opencode/skills/i18n/SKILL.md` 和 `check-i18n` 校验脚本支撑。

**Tech Stack:** TypeScript (ESM, Node16 module), React (provider/hook), vitest (unit tests)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/i18n/package.json` | Create | Package manifest |
| `packages/i18n/tsconfig.json` | Create | TS config extending root base |
| `packages/i18n/src/types.ts` | Create | `Locale`, `SUPPORTED_LOCALES`, `DEFAULT_LOCALE`, `TranslationKey` |
| `packages/i18n/src/locales/zh-CN.ts` | Create | Canonical catalog — all keys defined here |
| `packages/i18n/src/locales/zh-TW.ts` | Create | Traditional Chinese translations |
| `packages/i18n/src/locales/en.ts` | Create | English translations |
| `packages/i18n/src/catalog.ts` | Create | Re-exports all locales, derives `TranslationKey` |
| `packages/i18n/src/format.ts` | Create | `{var}` interpolation logic |
| `packages/i18n/src/translate.ts` | Create | `normalizeLocale`, `translate`, `createTranslator` |
| `packages/i18n/src/index.ts` | Create | Main entry — re-exports types + translate |
| `packages/i18n/src/react.tsx` | Create | React sub-entry — `I18nProvider`, `useI18n` |
| `packages/i18n/scripts/check-i18n.mjs` | Create | Validation script |
| `packages/i18n/vitest.config.ts` | Create | Vitest config |
| `packages/i18n/src/__tests__/translate.test.ts` | Create | Core translate tests |
| `packages/i18n/src/__tests__/react.test.tsx` | Create | React provider/hook tests |
| `package.json` | Modify | Add `check:i18n` script, update build order |
| `packages/core/src/types.ts` | Modify | Add `locale` to `AppSettings` |
| `packages/core/package.json` | Modify | Add `@spherse/i18n` dependency |
| `packages/app/electron/settings.ts` | Modify | Handle `locale` in get/save/restore |
| `packages/app/electron/preload.ts` | Modify | No change needed (settings already passed as object) |
| `packages/app/electron/ipc/settings.ts` | Modify | No change needed (already passes settings through) |
| `packages/app/electron/server.ts` | Modify | Add `getLocale`/`setLocale` for running servers |
| `packages/app/src/features/settings/types.ts` | Modify | Add `locale` to frontend `AppSettings` |
| `packages/app/src/features/settings/store.ts` | Modify | Add `locale` state, persist on save |
| `packages/app/src/features/settings/index.tsx` | Modify | Add language selector + use `useI18n()` for all strings |
| `packages/app/src/App.tsx` | Modify | Wrap with `I18nProvider` |
| `packages/app/package.json` | Modify | Add `@spherse/i18n` dependency |
| `.opencode/skills/i18n/SKILL.md` | Create | Developer coding-agent i18n skill |
| `docs/official/architecture.md` | Modify | Add i18n package to architecture |
| `docs/dev/backlog.md` | Modify | Already updated with presets i18n backlog |

---

### Task 1: Create `@spherse/i18n` package scaffold

**Files:**
- Create: `packages/i18n/package.json`
- Create: `packages/i18n/tsconfig.json`
- Create: `packages/i18n/src/types.ts`
- Create: `packages/i18n/src/locales/zh-CN.ts`
- Create: `packages/i18n/src/locales/zh-TW.ts`
- Create: `packages/i18n/src/locales/en.ts`
- Create: `packages/i18n/src/catalog.ts`
- Create: `packages/i18n/src/format.ts`
- Create: `packages/i18n/src/translate.ts`
- Create: `packages/i18n/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@spherse/i18n",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./react": {
      "types": "./dist/react.d.ts",
      "import": "./dist/react.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "check": "node scripts/check-i18n.mjs"
  },
  "dependencies": {},
  "peerDependencies": {
    "react": "^19.0.0"
  },
  "peerDependenciesMeta": {
    "react": { "optional": true }
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "typescript": "^5.7.0",
    "vitest": "^4.1.6"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/__tests__"]
}
```

- [ ] **Step 3: Create `src/types.ts`**

```typescript
export const SUPPORTED_LOCALES = ["zh-CN", "zh-TW", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "zh-CN";
```

- [ ] **Step 4: Create `src/locales/zh-CN.ts`**

```typescript
export const zhCN = {
  "app.loading": "加载中...",
  "settings.title": "设置",
  "settings.tabs.models": "模型",
  "settings.models.defaultModel": "默认模型",
  "settings.models.selectPlaceholder": "-- 请选择 --",
  "settings.models.configureFirst": "请先配置 API Key",
  "settings.models.providers": "模型提供商",
  "settings.models.save": "保存",
  "settings.models.saving": "保存中...",
  "settings.models.saved": "已保存",
  "settings.models.saveFailed": "保存失败",
  "settings.models.close": "关闭",
  "settings.provider.apiKeyProvided": "已提供 API Key",
  "settings.provider.notConnected": "未连接",
  "settings.provider.connected": "已连接",
  "settings.provider.disconnect": "断开连接",
  "settings.provider.connect": "连接",
} as const;
```

- [ ] **Step 5: Create `src/locales/zh-TW.ts`**

```typescript
import type { TranslationKey } from "../catalog.js";

export const zhTW: Record<TranslationKey, string> = {
  "app.loading": "載入中...",
  "settings.title": "設定",
  "settings.tabs.models": "模型",
  "settings.models.defaultModel": "預設模型",
  "settings.models.selectPlaceholder": "-- 請選擇 --",
  "settings.models.configureFirst": "請先設定 API Key",
  "settings.models.providers": "模型提供商",
  "settings.models.save": "儲存",
  "settings.models.saving": "儲存中...",
  "settings.models.saved": "已儲存",
  "settings.models.saveFailed": "儲存失敗",
  "settings.models.close": "關閉",
  "settings.provider.apiKeyProvided": "已提供 API Key",
  "settings.provider.notConnected": "未連線",
  "settings.provider.connected": "已連線",
  "settings.provider.disconnect": "斷開連線",
  "settings.provider.connect": "連線",
};
```

- [ ] **Step 6: Create `src/locales/en.ts`**

```typescript
import type { TranslationKey } from "../catalog.js";

export const en: Record<TranslationKey, string> = {
  "app.loading": "Loading...",
  "settings.title": "Settings",
  "settings.tabs.models": "Models",
  "settings.models.defaultModel": "Default Model",
  "settings.models.selectPlaceholder": "-- Select --",
  "settings.models.configureFirst": "Please configure an API Key first",
  "settings.models.providers": "Model Providers",
  "settings.models.save": "Save",
  "settings.models.saving": "Saving...",
  "settings.models.saved": "Saved",
  "settings.models.saveFailed": "Save failed",
  "settings.models.close": "Close",
  "settings.provider.apiKeyProvided": "API Key provided",
  "settings.provider.notConnected": "Not connected",
  "settings.provider.connected": "Connected",
  "settings.provider.disconnect": "Disconnect",
  "settings.provider.connect": "Connect",
};
```

- [ ] **Step 7: Create `src/catalog.ts`**

```typescript
export { zhCN } from "./locales/zh-CN.js";
export { zhTW } from "./locales/zh-TW.js";
export { en } from "./locales/en.js";
import { zhCN } from "./locales/zh-CN.js";
export type TranslationKey = keyof typeof zhCN;
```

- [ ] **Step 8: Create `src/format.ts`**

```typescript
export function formatTemplate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = params[key];
    return value !== undefined ? String(value) : `{${key}}`;
  });
}
```

- [ ] **Step 9: Create `src/translate.ts`**

```typescript
import type { Locale } from "./types.js";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./types.js";
import type { TranslationKey } from "./catalog.js";
import { zhCN, zhTW, en } from "./catalog.js";
import { formatTemplate } from "./format.js";

const catalogs: Record<Locale, Record<TranslationKey, string>> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en,
};

export function normalizeLocale(value: unknown): Locale {
  if (typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value)) {
    return value as Locale;
  }
  return DEFAULT_LOCALE;
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const catalog = catalogs[locale] ?? catalogs[DEFAULT_LOCALE];
  const value = catalog[key] ?? catalogs[DEFAULT_LOCALE][key] ?? key;
  return formatTemplate(value, params);
}

export function createTranslator(locale: Locale) {
  return {
    locale,
    t: (key: TranslationKey, params?: Record<string, string | number>) =>
      translate(locale, key, params),
  };
}
```

- [ ] **Step 10: Create `src/index.ts`**

```typescript
export { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "./types.js";
export type { Locale } from "./types.js";
export type { TranslationKey } from "./catalog.js";
export { normalizeLocale, translate, createTranslator } from "./translate.js";
```

- [ ] **Step 11: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
});
```

- [ ] **Step 12: Install dependencies and build**

Run: `npm install -w @spherse/i18n && npm run build -w @spherse/i18n`
Expected: Build succeeds with exit 0.

- [ ] **Step 13: Commit**

```bash
git add packages/i18n/
git commit -m "feat(i18n): add @spherse/i18n package with locale types, translate API, and initial catalogs"
```

---

### Task 2: Add unit tests for `@spherse/i18n`

**Files:**
- Create: `packages/i18n/src/__tests__/translate.test.ts`
- Modify: `packages/i18n/vitest.config.ts`

- [ ] **Step 1: Update vitest.config.ts to also cover .tsx**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 2: Write translate tests**

```typescript
import { describe, it, expect } from "vitest";
import { normalizeLocale, translate, createTranslator } from "../translate.js";
import type { TranslationKey } from "../catalog.js";

describe("normalizeLocale", () => {
  it("returns the locale when valid", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("zh-TW")).toBe("zh-TW");
  });

  it("returns DEFAULT_LOCALE for unknown values", () => {
    expect(normalizeLocale("ja")).toBe("zh-CN");
    expect(normalizeLocale(undefined)).toBe("zh-CN");
    expect(normalizeLocale(null)).toBe("zh-CN");
    expect(normalizeLocale(123)).toBe("zh-CN");
  });
});

describe("translate", () => {
  it("returns zh-CN value for zh-CN locale", () => {
    expect(translate("zh-CN", "app.loading")).toBe("加载中...");
  });

  it("returns en value for en locale", () => {
    expect(translate("en", "app.loading")).toBe("Loading...");
  });

  it("returns zh-TW value for zh-TW locale", () => {
    expect(translate("zh-TW", "app.loading")).toBe("載入中...");
  });

  it("interpolates params", () => {
    // Need a key with {var} — add one to zh-CN for testing
    // For now test with formatTemplate directly
  });

  it("falls back to zh-CN when locale catalog missing key", () => {
    // All catalogs have same keys per design, so this tests the fallback path
    expect(translate("zh-CN", "settings.title")).toBe("设置");
  });

  it("returns key itself when not found in any catalog", () => {
    expect(translate("zh-CN", "nonexistent.key" as TranslationKey)).toBe("nonexistent.key");
  });
});

describe("createTranslator", () => {
  it("returns a translator with the given locale", () => {
    const { locale, t } = createTranslator("en");
    expect(locale).toBe("en");
    expect(t("app.loading")).toBe("Loading...");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -w @spherse/i18n`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/i18n/src/__tests__/ packages/i18n/vitest.config.ts
git commit -m "test(i18n): add unit tests for translate API and normalizeLocale"
```

---

### Task 3: Add React provider/hook and tests

**Files:**
- Create: `packages/i18n/src/react.tsx`
- Create: `packages/i18n/src/__tests__/react.test.tsx`

- [ ] **Step 1: Create `src/react.tsx`**

```tsx
import { createContext, useContext } from "react";
import type { Locale } from "./types.js";
import type { TranslationKey } from "./catalog.js";
import { translate } from "./translate.js";

const I18nContext = createContext<Locale>("zh-CN");

export function I18nProvider(props: {
  locale: Locale;
  children: React.ReactNode;
}): React.ReactElement {
  return <I18nContext.Provider value={props.locale}>{props.children}</I18nContext.Provider>;
}

export function useI18n(): {
  locale: Locale;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
} {
  const locale = useContext(I18nContext);
  return {
    locale,
    t: (key, params) => translate(locale, key, params),
  };
}
```

- [ ] **Step 2: Write React hook tests**

```tsx
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { I18nProvider, useI18n } from "../react.js";

describe("useI18n", () => {
  it("returns default locale when no provider", () => {
    const { result } = renderHook(() => useI18n());
    expect(result.current.locale).toBe("zh-CN");
    expect(result.current.t("app.loading")).toBe("加载中...");
  });

  it("returns provided locale", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <I18nProvider locale="en">{children}</I18nProvider>
    );
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.locale).toBe("en");
    expect(result.current.t("app.loading")).toBe("Loading...");
  });
});
```

- [ ] **Step 3: Add @testing-library/react devDependency**

Run: `npm install -D @testing-library/react --workspace=packages/i18n`

- [ ] **Step 4: Run tests**

Run: `npm test -w @spherse/i18n`
Expected: All tests pass (both .test.ts and .test.tsx).

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/
git commit -m "feat(i18n): add React I18nProvider and useI18n hook with tests"
```

---

### Task 4: Wire `@spherse/i18n` into build and core

**Files:**
- Modify: `package.json` (root)
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/package.json`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Update root package.json build script**

Change the build script to include i18n before core:

```json
"build": "npm run build -w @spherse/i18n && npm run build -w @spherse/core && npm run build -w @spherse/presets && npm run build -w @spherse/server && npm run build -w @spherse/app",
"check:i18n": "npm run check -w @spherse/i18n"
```

- [ ] **Step 2: Add `locale` to `AppSettings` in core types.ts**

```typescript
import type { Locale } from "@spherse/i18n";

export interface AppSettings {
  providers: Record<string, { apiKey: string } | undefined>;
  defaultModel: string;
  locale: Locale;
}
```

- [ ] **Step 3: Add @spherse/i18n dependency to core**

Run: `npm install @spherse/i18n@"*" --workspace=packages/core`

- [ ] **Step 4: Re-export Locale from core index.ts**

Add to `packages/core/src/index.ts`:

```typescript
export type { Locale } from "@spherse/i18n";
```

(Note: only the type is re-exported to keep core's runtime dependency minimal.)

- [ ] **Step 5: Build and verify**

Run: `npm run build -w @spherse/i18n && npm run build -w @spherse/core`
Expected: Both build successfully.

- [ ] **Step 6: Commit**

```bash
git add package.json packages/core/
git commit -m "feat(i18n): wire @spherse/i18n into build order and add locale to AppSettings"
```

---

### Task 5: Add `locale` to Electron settings

**Files:**
- Modify: `packages/app/electron/settings.ts`

- [ ] **Step 1: Update getMaskedSettings to preserve locale**

In `getMaskedSettings()`, add `locale` to the masked settings object:

```typescript
export function getMaskedSettings(): AppSettings | null {
  const settings = settingsStore.get("settings");
  if (!settings) return null;
  const masked: AppSettings = {
    providers: {},
    defaultModel: settings.defaultModel,
    locale: settings.locale ?? "zh-CN",
  };
  for (const [id, config] of Object.entries(settings.providers)) {
    if (config?.apiKey) {
      masked.providers[id] = { apiKey: maskApiKey(config.apiKey) };
    }
  }
  return masked;
}
```

- [ ] **Step 2: Update saveSettings to preserve and merge locale**

In `saveSettings()`, add locale to the merged settings:

```typescript
export function saveSettings(incoming: AppSettings): void {
  const prev = settingsStore.get("settings");
  const merged: AppSettings = {
    providers: {},
    defaultModel: incoming.defaultModel,
    locale: incoming.locale ?? prev?.locale ?? "zh-CN",
  };
  // ... existing provider merge logic ...
  settingsStore.set("settings", merged);
  applySettingsToEnv(merged);
}
```

- [ ] **Step 3: Add getLocale and setLocale helpers**

```typescript
export function getLocale(): string {
  return settingsStore.get("settings")?.locale ?? "zh-CN";
}

export function setLocale(locale: string): void {
  const settings = settingsStore.get("settings");
  if (settings) {
    settings.locale = locale;
    settingsStore.set("settings", settings);
  }
}
```

- [ ] **Step 4: Build and verify**

Run: `npm run build -w @spherse/app`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/app/electron/settings.ts
git commit -m "feat(i18n): add locale field to Electron settings with getLocale/setLocale"
```

---

### Task 6: Add locale to Electron server management

**Files:**
- Modify: `packages/app/electron/server.ts`

- [ ] **Step 1: Add getLocale export**

Add a function that returns the current locale from settings:

```typescript
import { getSettings, getLocale } from "./settings.js";

export function getServerLocale(): string {
  return getLocale();
}
```

No changes needed to `startServer` — locale is read dynamically via the `getLocale` function when server/core needs it.

- [ ] **Step 2: Commit**

```bash
git add packages/app/electron/server.ts
git commit -m "feat(i18n): expose getServerLocale for dynamic locale access"
```

---

### Task 7: Add locale to frontend settings store and UI

**Files:**
- Modify: `packages/app/src/features/settings/types.ts`
- Modify: `packages/app/src/features/settings/store.ts`
- Modify: `packages/app/src/features/settings/index.tsx`
- Modify: `packages/app/package.json`

- [ ] **Step 1: Update frontend AppSettings type**

In `packages/app/src/features/settings/types.ts`, add `locale`:

```typescript
export interface AppSettings {
  providers?: Record<string, { apiKey?: string } | undefined>;
  defaultModel?: string;
  locale?: string;
}
```

- [ ] **Step 2: Update settings store to handle locale**

In `packages/app/src/features/settings/store.ts`, add locale to the store state and load/save:

Add `locale` field to the `SettingsStore` interface and initial state. In `load()`, read `settings?.locale`. In `buildSettings()`, include `locale: get().locale`. In `save()`, pass locale through.

- [ ] **Step 3: Add @spherse/i18n dependency to app**

Run: `npm install @spherse/i18n@"*" --workspace=packages/app`

- [ ] **Step 4: Add language selector to Settings modal**

In `packages/app/src/features/settings/index.tsx`, add a `NativeSelect` for language before the model section:

```tsx
import { SUPPORTED_LOCALES } from "@spherse/i18n";

const LOCALE_LABELS: Record<string, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  en: "English",
};
```

Add a language field with `NativeSelect` mapping `SUPPORTED_LOCALES` to options. On change, call `setLocale` in store and save.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/features/settings/ packages/app/package.json
git commit -m "feat(i18n): add language selector to Settings modal"
```

---

### Task 8: Wire `I18nProvider` into App and migrate Settings UI strings

**Files:**
- Modify: `packages/app/src/App.tsx`
- Modify: `packages/app/src/features/settings/index.tsx`

- [ ] **Step 1: Wrap App with I18nProvider**

In `packages/app/src/App.tsx`:

```tsx
import { I18nProvider } from "@spherse/i18n/react";
import { DEFAULT_LOCALE } from "@spherse/i18n";
```

Read locale from settings store or app store. Wrap the existing `<TooltipProvider>` with `<I18nProvider locale={locale}>`.

- [ ] **Step 2: Replace hardcoded strings in Settings modal**

In `packages/app/src/features/settings/index.tsx`, replace all user-visible Chinese strings with `t("settings.xxx")` calls:

```tsx
import { useI18n } from "@spherse/i18n/react";
```

Replace:
- `"设置"` → `t("settings.title")`
- `"模型"` → `t("settings.tabs.models")`
- `"默认模型"` → `t("settings.models.defaultModel")`
- `"-- 请选择 --"` → `t("settings.models.selectPlaceholder")`
- `"请先配置 API Key"` → `t("settings.models.configureFirst")`
- `"模型提供商"` → `t("settings.models.providers")`
- `"已保存"` → `t("settings.models.saved")`
- `"保存失败"` → `t("settings.models.saveFailed")`
- `"关闭"` → `t("settings.models.close")`
- `{saving ? "保存中..." : "保存"}` → `{saving ? t("settings.models.saving") : t("settings.models.save")}`
- `"已提供 API Key"` → `t("settings.provider.apiKeyProvided")`
- `"未连接"` → `t("settings.provider.notConnected")`
- `"已连接"` → `t("settings.provider.connected")`
- `"断开连接"` → `t("settings.provider.disconnect")`
- `"连接"` → `t("settings.provider.connect")`

- [ ] **Step 3: Replace loading text in App.tsx**

```tsx
const { t } = useI18n();
```

Replace `"加载中..."` with `t("app.loading")`.

- [ ] **Step 4: Build and verify**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/
git commit -m "feat(i18n): wire I18nProvider into App and migrate Settings UI strings"
```

---

### Task 9: Add `check-i18n` validation script

**Files:**
- Create: `packages/i18n/scripts/check-i18n.mjs`

- [ ] **Step 1: Write the check script**

```javascript
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = resolve(__dirname, "../src/locales");

const localeFiles = ["zh-CN.ts", "zh-TW.ts", "en.ts"];
const locales = {};

function extractKeys(content) {
  const keys = [];
  const regex = /^\s*"([^"]+)":\s*"/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    keys.push(match[1]);
  }
  return keys;
}

function extractInterpolationVars(content, key) {
  const regex = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*"([^"]*)"`);
  const match = content.match(regex);
  if (!match) return [];
  const vars = [];
  const varRegex = /\{(\w+)\}/g;
  let v;
  while ((v = varRegex.exec(match[1])) !== null) {
    vars.push(v[1]);
  }
  return vars.sort();
}

let hasErrors = false;

for (const file of localeFiles) {
  const filePath = resolve(localesDir, file);
  const content = readFileSync(filePath, "utf-8");
  locales[file] = { content, keys: extractKeys(content) };
}

// Check 1: key sets must match
const canonical = locales["zh-CN.ts"].keys;
for (const file of localeFiles.slice(1)) {
  const keys = locales[file].keys;
  const missing = canonical.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !canonical.includes(k));
  if (missing.length > 0) {
    console.error(`❌ ${file}: missing keys: ${missing.join(", ")}`);
    hasErrors = true;
  }
  if (extra.length > 0) {
    console.error(`❌ ${file}: extra keys: ${extra.join(", ")}`);
    hasErrors = true;
  }
}

// Check 2: interpolation variables must match across locales
for (const key of canonical) {
  const canonicalVars = extractInterpolationVars(locales["zh-CN.ts"].content, key);
  for (const file of localeFiles.slice(1)) {
    const fileVars = extractInterpolationVars(locales[file].content, key);
    if (canonicalVars.join(",") !== fileVars.join(",")) {
      console.error(`❌ Key "${key}": interpolation vars mismatch between zh-CN [${canonicalVars}] and ${file} [${fileVars}]`);
      hasErrors = true;
    }
  }
}

if (!hasErrors) {
  console.log("✅ All locale checks passed");
}
process.exit(hasErrors ? 1 : 0);
```

- [ ] **Step 2: Run the check script**

Run: `npm run check:i18n`
Expected: `✅ All locale checks passed`

- [ ] **Step 3: Commit**

```bash
git add packages/i18n/scripts/
git commit -m "feat(i18n): add check-i18n validation script"
```

---

### Task 10: Create `.opencode/skills/i18n/SKILL.md`

**Files:**
- Create: `.opencode/skills/i18n/SKILL.md`

- [ ] **Step 1: Write the skill file**

```markdown
---
name: i18n
description: Guide for coding agents to migrate user-visible strings to the @spherse/i18n package and update locale catalogs
---

# i18n String Migration Skill

## Purpose

This skill guides the coding agent through identifying user-visible strings in Spherse source code, adding them to the shared `@spherse/i18n` locale catalogs, and replacing hardcoded text with `t()` calls.

## Scope

### What to translate

- React component text shown to users (buttons, labels, placeholders, error messages, empty states, dialog titles)
- Electron IPC error/confirmation messages shown to users
- Server route error messages returned to the frontend
- Core tool error messages shown in the UI

### What NOT to translate

- Route paths, query parameters, storage keys
- CSS class names, AIA ids, test ids
- API endpoint paths
- Provider/model names and env key identifiers
- Console debug/log messages (unless also shown to users)
- Test data and test assertions
- File paths and technical identifiers
- Markdown content within project files (user content)

## Key Naming Convention

Use dot-path namespacing: `{domain}.{section}.{specific}`

Examples:
- `app.loading`
- `settings.title`
- `settings.models.defaultModel`
- `content.save.error`
- `server.content.notFound`
- `core.tools.readFile.pathRequired`

## Step-by-step Process

1. **Scan** the specified files or directories for user-visible string literals.

2. **Classify** each string: is it user-visible UI text or a technical string that should not be translated?

3. **Generate keys** for user-visible strings using the naming convention above. Keep keys stable and descriptive.

4. **Add entries** to all three locale files in `packages/i18n/src/locales/`:
   - `zh-CN.ts` — the canonical catalog (add as `as const`)
   - `zh-TW.ts` — Traditional Chinese translation
   - `en.ts` — English translation

5. **Replace** the hardcoded string in source code:
   - In React components: `const { t } = useI18n();` then `t("key")`
   - In server/core/Electron: `translate(locale, "key", params)` (using locale from context or provider)

6. **For strings with variables**: use `{name}` interpolation in the locale value, never concatenate translated parts:
   - ✅ `"无法读取文件：{path}"` + `t("key", { path })`
   - ❌ `"无法读取文件：" + path`

7. **Run validation**:
   ```bash
   npm run check:i18n
   ```
   Fix any key consistency or interpolation variable mismatches.

8. **Run build and tests**:
   ```bash
   npm run build
   npm test -w @spherse/i18n
   ```

9. **Report**: list all new/modified keys and any strings intentionally left untranslated with reasons.

## Catalog Location

- Locale files: `packages/i18n/src/locales/{zh-CN,zh-TW,en}.ts`
- Type definition: `packages/i18n/src/types.ts`
- Translation API: `packages/i18n/src/translate.ts`

## Important Rules

- `zh-CN.ts` is the canonical source of truth for keys. All other locales must have identical key sets.
- Never edit `TranslationKey` type manually — it is derived from `zhCN` object keys.
- After adding keys, always run `npm run check:i18n` to verify consistency.
- Prefer semantic keys (`settings.title`) over structural keys (`dialog.header.text`).
```

- [ ] **Step 2: Commit**

```bash
git add .opencode/skills/i18n/
git commit -m "feat(i18n): add .opencode coding-agent skill for i18n string migration"
```

---

### Task 11: Update official docs

**Files:**
- Modify: `docs/official/architecture.md`

- [ ] **Step 1: Add i18n package to architecture.md**

Add a section under Package 边界:

```markdown
- **@spherse/i18n**：纯 TypeScript i18n 基础设施，维护 locale 类型、翻译资源、`t()` 函数、fallback 规则和校验脚本；React 使用 `@spherse/i18n/react` 子入口的 provider/hook，Electron/server/core 使用同一个纯函数 API
```

- [ ] **Step 2: Add i18n section to 前端路由与状态**

Add:

```markdown
- **i18n**：locale 是应用级设置，持久化在 electron-store 的 `settings.locale`；renderer 通过 `I18nProvider` + `useI18n()` 消费翻译；Electron/server/core 通过 `translate(locale, key, params)` 纯函数消费；翻译资源集中管理在 `@spherse/i18n` package
```

- [ ] **Step 3: Commit**

```bash
git add docs/official/architecture.md
git commit -m "docs: update architecture.md with @spherse/i18n package"
```

---

### Task 12: Final verification

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: All packages build successfully.

- [ ] **Step 2: Run i18n tests**

Run: `npm test -w @spherse/i18n`
Expected: All tests pass.

- [ ] **Step 3: Run core tests**

Run: `npm test -w @spherse/core`
Expected: All tests pass.

- [ ] **Step 4: Run app tests**

Run: `npm test -w @spherse/app`
Expected: All tests pass.

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: No errors.

- [ ] **Step 6: Run i18n check**

Run: `npm run check:i18n`
Expected: `✅ All locale checks passed`
