# [infra] Dev/Prod 环境隔离

## 背景

当前 dev（`electron-vite dev`）和 prod（打包后的 release 版本）共用同一个 Electron `userData` 目录：

- **macOS**: `~/Library/Application Support/Spherse/`
- **Windows**: `%APPDATA%/Spherse/`

共享导致的问题：
1. dev 和 prod 无法同时运行 — electron-store 和 Chromium localStorage 会在同一路径下产生写入冲突
2. 开发测试数据污染生产配置（API keys、打开项目列表等）
3. 调试困难 — 无法对比 dev 和 prod 的行为差异，因为数据完全耦合

## 需求

| 需求 | 优先级 |
|------|--------|
| dev 和 prod 可以同时运行 | P0 |
| 数据完全隔离（settings、localStorage、缓存） | P0 |
| 构建时自动区分，无需手动配置 | P0 |
| 用户项目数据（`.spherse/`）共享 | P0 |

## 方案：`app.setPath('userData')` 引导文件

### 原理

Electron 的 `userData` 目录是所有应用级存储的根目录。通过在进程启动最早期调用 `app.setPath('userData', ...)` 将 dev 环境重定向到独立路径，实现所有存储的自动隔离。

### 架构

```
electron-vite dev 启动 → bootstrap.ts 执行
  ├─ app.isPackaged === false → setPath('userData', 'Spherse-Dev')
  └─ import('./main.js') → main.ts 及其依赖使用新的 userData 路径

electron-builder 打包后启动 → bootstrap.ts 执行
  ├─ app.isPackaged === true → 保持默认 userData 路径
  └─ import('./main.js') → main.ts 及其依赖使用默认路径
```

### 为什么需要独立的引导文件

`app.setPath('userData', ...)` 必须在 `electron-store` 创建 Store 实例之前执行。但 `electron-store` 在 `settings.ts` 中以模块级常量初始化：

```typescript
export const settingsStore = new Store<SettingsSchema>({ name: "settings" });
```

由于 ESM `import` 语句会被提升并在模块级代码之前求值，将 `app.setPath` 放在 `main.ts` 的 import 之后无法保证执行顺序。独立引导文件 + 动态 `import()` 确保路径设置先于所有业务模块加载。

### 数据目录映射

| 环境 | macOS | Windows |
|------|-------|---------|
| dev | `~/Library/Application Support/Spherse-Dev/` | `%APPDATA%/Spherse-Dev/` |
| prod | `~/Library/Application Support/Spherse/` | `%APPDATA%/Spherse/` |

### 隔离范围

**自动隔离**（跟随 userData 目录）：

| 资源 | 说明 |
|------|------|
| electron-store | `settings.json`（API keys、项目列表、上次活跃项目） |
| localStorage | Chromium 渲染进程本地存储（聊天草稿 `spherse:draft:*`） |
| Chromium 缓存 | HTTP 缓存、Service Worker 等 |
| 未来存储 | IndexedDB、Session Storage 等 |

**不隔离**（设计如此）：

| 资源 | 原因 |
|------|------|
| 用户项目数据（`.spherse/`） | 按项目路径天然隔离，dev/prod 可打开同一项目 |
| Fastify 服务端口 | 已使用随机端口，天然不冲突 |
| `app.isPackaged` / `isDev` IPC | 仍正确反映环境，无需改动 |

## 文件变更清单

### 新增

| 文件 | 说明 |
|------|------|
| `packages/app/electron/bootstrap.ts` | 入口引导文件，设置 userData 路径后动态导入 main |

### 修改

| 文件 | 变更 |
|------|------|
| `packages/app/electron.vite.config.ts` | main 入口从 `electron/main.ts` 改为 `electron/bootstrap.ts` |

### 无需修改

- `electron/main.ts` — 业务逻辑不变
- `electron/settings.ts` — electron-store 自动使用新 userData 路径
- `src/features/chat/Composer.tsx` — localStorage 自动隔离
- `electron/ipc/debug.ts` — `isDev` 仍基于 `app.isPackaged`，行为正确
- E2E 测试 — 已使用 `--user-data-dir` 和 `XDG_CONFIG_HOME` 隔离，不受影响

## 实现细节

### bootstrap.ts

```typescript
import { app } from "electron";
import path from "node:path";

if (!app.isPackaged) {
  const defaultUserData = app.getPath("userData");
  app.setPath("userData", path.join(path.dirname(defaultUserData), "Spherse-Dev"));
}

import("./main.js");
```

- `app.isPackaged` 和 `app.getPath('userData')` 在进程启动时即可同步调用，无需等待 `ready` 事件
- 动态 `import()` 确保 main.ts 及其所有依赖在 userData 路径设置完成后才加载

### electron.vite.config.ts 变更

```diff
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: {
-         index: resolve(__dirname, "electron/main.ts"),
+         index: resolve(__dirname, "electron/bootstrap.ts"),
        },
      },
    },
  },
```

## 验证方式

1. 运行 `npm run dev`，确认 `~/Library/Application Support/Spherse-Dev/` 被创建
2. 在 dev 中配置 API keys，然后启动 prod 安装包，确认 prod 无 dev 的配置
3. 同时运行 dev 和 prod，确认两者可以独立操作不冲突
4. 确认 dev 和 prod 打开同一用户项目时共享 `.spherse/` 数据
