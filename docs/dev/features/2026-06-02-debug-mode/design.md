# Debug Mode

## Overview

提供仅 dev 模式下的调试工具入口。在 Activity Bar 底部显示 debug 按钮，点击弹出菜单，包含 DevTools 开关、renderer 重载、electron-store 查看器、以及 app 数据重置功能。

## User Stories

1. 开发者在 dev 模式下看到 debug 按钮，点击可快速开关 DevTools
2. 开发者想查看 electron-store 中存储的完整数据，通过 viewer 查看格式化的 JSON 原文
3. 开发者需要重载 renderer 页面来刷新前端状态
4. 开发者需要清除所有 app 数据并重启，通过确认弹窗安全执行

## Dev 模式检测

使用 Electron 官方 API `app.isPackaged`：

- `app.isPackaged === false` → dev 模式
- `app.isPackaged === true` → 生产模式（打包后）

Main 进程通过 IPC 暴露 `isDev()` 给 renderer。Renderer 端在 `app-store` 中缓存 dev 状态。

## Activity Bar 布局

```
+------------+
| Activity   |
| Bar (56px) |
|            |
| [项] active|
| [目]       |
| [首]       |
| [字]       |
|            |
|  [🐛] ← dev only, Tooltip: "Debug"
|  [⚙]      |
|  [+]       |
+------------+
```

- Debug 按钮：lucide-react `Bug` 图标，`variant="ghost"`, `size="icon-lg"`
- 仅在 `isDev` 为 true 时渲染
- 位于 Settings 按钮上方

## Debug 菜单

点击 debug 按钮弹出 shadcn `DropdownMenu`：

| 菜单项 | 类型 | 行为 |
|--------|------|------|
| DevTools | Checkbox（toggle） | 调用 `toggleDevTools` IPC |
| --- Separator --- | | |
| Reload | Button | 调用 `reloadRenderer` IPC |
| App Data Viewer | Button | 打开 store viewer Dialog |
| --- Separator --- | | |
| Reset App Data | Button（destructive） | 弹出 AlertDialog 确认后执行 |

## electron-store Viewer Dialog

**触发**：点击菜单中的 "App Data Viewer"。

**组件**：shadcn `Dialog`，`max-w-2xl max-h-[80vh]`。

**内容**：
- Dialog 标题："App Data"
- `<pre>` 区域，显示 `JSON.stringify(data, null, 2)` 格式化的 JSON 原文
- `font-mono`，`overflow-auto`

**数据流**：每次打开 Dialog 时调用 `getElectronStoreData` IPC 获取最新数据，不缓存。

## Reset App Data 确认流程

使用 shadcn `AlertDialog`：
- 标题："Reset App Data"
- 描述："This will clear all app settings, project list, and restart the application. This cannot be undone."
- 按钮：Cancel（默认）+ Reset（destructive variant）

执行：`store.clear()` → `app.relaunch()` → `app.exit(0)`

## IPC Design

### 新增 IPC handlers

| Channel | 实现 |
|---------|------|
| `isDev` | `() => !app.isPackaged` |
| `toggleDevTools` | `getWindow().webContents.toggleDevTools()` |
| `getElectronStoreData` | `() => store.store` |
| `reloadRenderer` | `getWindow().webContents.reload()` |
| `resetAppData` | `store.clear() → app.relaunch() → app.exit(0)` |

### Preload 扩展

```ts
contextBridge.exposeInMainWorld("electronAPI", {
  ...existing,
  isDev: () => ipcRenderer.invoke("isDev"),
  toggleDevTools: () => ipcRenderer.invoke("toggleDevTools"),
  getElectronStoreData: () => ipcRenderer.invoke("getElectronStoreData"),
  reloadRenderer: () => ipcRenderer.invoke("reloadRenderer"),
  resetAppData: () => ipcRenderer.invoke("resetAppData"),
});
```

### window.ts 改动

移除 unconditional `mainWindow.webContents.openDevTools()` 调用。DevTools 改为由 debug 菜单控制。

## File Change Summary

### Electron 层

| 文件 | 改动 |
|------|------|
| `electron/ipc/debug.ts` | 新建，注册 debug 相关 IPC handlers |
| `electron/ipc/index.ts` | 注册 `registerDebugIpc` |
| `electron/preload.ts` | 暴露 5 个新方法 |
| `electron/window.ts` | 移除 unconditional `openDevTools()` |

### 前端

| 文件 | 改动 |
|------|------|
| `features/debug-tools/index.tsx` | 新建，导出 `<DebugTools />`（内含 dev 检测 + 条件渲染） |
| `features/debug-tools/DebugMenu.tsx` | DropdownMenu + StoreViewer Dialog + Reset AlertDialog |
| `features/activity-bar/index.tsx` | 引入 `<DebugTools />` |
| 类型声明文件 | 扩展 `window.electronAPI` 类型 |

### 不涉及

- `packages/core` — 无改动
- `packages/server` — 无改动

## Out of Scope

- Chat Debug 模式（展示 agent tool call 原始数据、system prompt 等）— 见 backlog
- SQLite session 数据 viewer
- 项目 `.spherse/` 目录结构 viewer
- Debug 模式快捷键绑定
