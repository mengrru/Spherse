# Settings Feature Design

## Overview

在应用左下角添加设置按钮，点击后弹出模态框，允许用户配置模型 API Key 和选择默认模型。MVP 阶段支持 DeepSeek 和 z.ai 两个 provider。

设置是全局的（应用级别），所有项目共享。使用 electron-store 存储，保存时将 API Key 写入 `process.env` 供 pi-ai 自动读取。

## Data Model

### AppSettings

新增类型，定义在 `packages/core/src/types.ts`：

```typescript
export interface AppSettings {
  providers: {
    deepseek?: { apiKey: string };
    zai?: { apiKey: string };
  };
  defaultModel: string;
}
```

### SUPPORTED_PROVIDERS

硬编码常量，定义在 `packages/core/src/types.ts`：

```typescript
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

### Storage

使用 `electron-store` 存储，位于 Electron userData 目录。Schema：

```json
{
  "providers": {
    "deepseek": { "apiKey": "sk-..." },
    "zai": { "apiKey": "sk-..." }
  },
  "defaultModel": "deepseek-v4-pro"
}
```

## Architecture

### Layer Responsibilities

| Layer | Responsibility |
|-------|---------------|
| **Core** | 定义 `AppSettings`、`SUPPORTED_PROVIDERS` 类型；扩展 `resolveModel()` |
| **Server** | 提供 `GET /api/settings/providers` 路由返回模型列表 |
| **Electron Main** | 管理 electron-store；IPC handlers 读写设置；启动时恢复 env |
| **Preload** | 暴露 `getSettings`、`saveSettings`、`getSupportedProviders` |
| **React** | SettingsModal 组件；ProjectPage 左下角设置按钮 |

### Settings Read/Write Flow

```
保存设置:
  用户点击保存 → React 调用 window.electronAPI.saveSettings(settings)
  → IPC → Electron Main → electron-store.set() + process.env[envKey] = apiKey

读取设置:
  应用启动 → Electron Main → electron-store.get() → 遍历 providers 写入 process.env
  UI 打开 → window.electronAPI.getSettings() → 返回脱敏后的 settings

模型列表:
  React → HTTP GET /api/settings/providers → Server 返回 SUPPORTED_PROVIDERS
```

### API Key 注入

保存设置时，Electron 主进程将 API Key 写入 `process.env`：

- `settings.providers.deepseek.apiKey` → `process.env.DEEPSEEK_API_KEY`
- `settings.providers.zai.apiKey` → `process.env.ZAI_API_KEY`

应用启动时（`app.on('ready')`）从 electron-store 读取所有已配置的 key 并写入 process.env，确保 pi-ai 在后续调用中自动拾取。

## Core Layer Changes

### packages/core/src/types.ts

新增 `AppSettings` 接口和 `SUPPORTED_PROVIDERS` 常量（如上所述）。

### packages/core/src/agent-engine.ts

修改 `resolveModel()` 方法，扩展 provider 尝试列表：

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

将用户已配置的 provider 放在前面优先尝试。

### packages/core/src/index.ts

新增导出 `AppSettings`、`SUPPORTED_PROVIDERS`、`SupportedProviderId`。

## Server Layer Changes

### packages/server/src/routes.ts

新增路由：

```
GET /api/settings/providers
```

返回 `SUPPORTED_PROVIDERS` 常量，供前端获取 provider 名称、envKey 和模型列表。

## Electron Layer Changes

### packages/app/electron/main.ts

1. 引入 `electron-store`，创建 store 实例
2. `app.on('ready')` 时从 store 读取设置，将 API Key 写入 `process.env`
3. 新增 IPC handlers：

```typescript
ipcMain.handle('get-settings', () => {
    const settings = store.get('settings') as AppSettings | undefined;
    // 脱敏：apiKey 只保留前后4位
    return maskSettings(settings);
});

ipcMain.handle('save-settings', (_event, settings: AppSettings) => {
    const prev = store.get('settings') as AppSettings | undefined;
    // 合并：如果前端传来的 apiKey 是脱敏的（包含 ****），保留旧值
    const merged = mergeSettings(prev, settings);
    store.set('settings', merged);
    for (const [id, config] of Object.entries(merged.providers)) {
        if (config?.apiKey) {
            const envKey = SUPPORTED_PROVIDERS[id as SupportedProviderId].envKey;
            process.env[envKey] = config.apiKey;
        }
    }
    return { success: true };
});

ipcMain.handle('get-supported-providers', () => {
    return SUPPORTED_PROVIDERS;
});
```

### packages/app/electron/preload.ts

新增暴露：

```typescript
getSettings: () => ipcRenderer.invoke('get-settings'),
saveSettings: (settings: AppSettings) => ipcRenderer.invoke('save-settings', settings),
getSupportedProviders: () => ipcRenderer.invoke('get-supported-providers'),
```

## React Layer Changes

### SettingsModal Component

新增 `packages/app/src/components/SettingsModal.tsx`：

模态框布局分为两部分：

**API 配置区**
- 每个 provider 一行：名称 + API Key 输入框（password 类型）+ 状态指示器（绿点=已配置）
- API Key 输入框右侧有"显示/隐藏"切换按钮
- DeepSeek 和 z.ai 各一行

**默认模型区**
- 下拉选择器，按 provider 分组
- 只有已配置 API Key 的 provider 的模型才出现在列表中
- 每个选项显示模型 ID

**底部**：保存按钮 + 取消按钮

### ProjectPage 修改

在 `packages/app/src/pages/ProjectPage.tsx` 左侧边栏底部添加齿轮图标按钮。

按钮位于 FileTree 组件下方、sidebar 底部，使用 `margin-top: auto` 定位。

点击按钮设置 `showSettings` state 为 true，打开 SettingsModal。

### Interaction Flow

1. 用户点击左下角齿轮按钮
2. SettingsModal 打开，调用 `window.electronAPI.getSettings()` 加载当前设置
3. 用户填写/修改 API Key，选择默认模型
4. 点击保存 → 调用 `window.electronAPI.saveSettings(settings)`
5. IPC 传递到 Electron 主进程 → electron-store 持久化 + process.env 更新
6. 模态框显示"保存成功"提示，关闭

## File Change Summary

| File | Action |
|------|--------|
| `packages/core/src/types.ts` | 新增 `AppSettings`、`SUPPORTED_PROVIDERS`、`SupportedProviderId` |
| `packages/core/src/agent-engine.ts` | 修改 `resolveModel()` 扩展 provider 列表 |
| `packages/core/src/index.ts` | 新增导出 |
| `packages/server/src/routes.ts` | 新增 `GET /api/settings/providers` |
| `packages/app/electron/main.ts` | 引入 electron-store，新增 IPC handlers，启动时恢复 env |
| `packages/app/electron/preload.ts` | 新增 settings 相关 API 暴露 |
| `packages/app/src/components/SettingsModal.tsx` | 新增组件 |
| `packages/app/src/pages/ProjectPage.tsx` | 添加齿轮按钮 + SettingsModal 集成 |
| `packages/app/package.json` | 新增 `electron-store` 依赖 |

## Future Considerations

- 新增 provider 只需在 `SUPPORTED_PROVIDERS` 中添加条目，UI 自动渲染
- 可扩展支持 OAuth 类 provider（Anthropic、GitHub Copilot）
- 可添加"测试连接"按钮验证 API Key 有效性
- 可支持自定义 API endpoint（如自建的 OpenAI 兼容服务）
