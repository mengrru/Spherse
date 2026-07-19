# 移动端 App 设计

## 背景与目标

当前 Spherse 是 Electron 桌面应用。本次目标是扩展移动端支持，让用户能在手机上继续与 agent 对话、查看项目内容。

**整体思路**：桌面端 Electron 内嵌的 Fastify server 仍然是唯一的服务端，移动端作为远程客户端通过公网中继连接到桌面 server。

**核心定位（已确认）**：

- 移动端是**只读浏览器 + 聊天客户端**，不做项目管理、agent 配置、skill 安装等桌面专属操作
- 中继方案选 **Cloudflare Quick Tunnel**（零账号、零配置；URL 每次重启变化，移动端需要重扫 QR）
- 鉴权用**单一 Bearer Token**（QR 内含），任何拿到 QR 的人等同于完全权限
- 前端三层分离：`packages/app`（共享）+ `packages/desktop`（Electron shell）+ `packages/web`（PWA shell）
- 中继层抽象 `TunnelProvider` 接口，默认 Cloudflare 实现，预留未来扩展

## 整体架构

```
[手机 PWA] ←QR→ [桌面 Electron]
                   ↓ cloudflared tunnel
                [Cloudflare Edge]
                   ↓ 反向代理
                [Fastify :127.0.0.1:random]
                   ↓ Bearer Token 校验
                [ProjectRegistry]
                   ↓
                [本地文件系统 / agents / sessions]
```

**关键观察**：现有架构已经为复用铺好路。

- Renderer 是纯 React SPA（Hash Router），不直接 import Node.js
- `createApiClient(baseUrl, projectId)`（`packages/app/src/lib/api.ts:40`）只依赖 `baseUrl`，换 URL 即可工作
- WebSocket 也只用 `baseUrl.replace(/^http/, "ws")`，不耦合 Electron
- Contract schema 已统一在 `@spherse/server/contracts`
- 唯一硬耦合点是 `window.electronAPI`（58 处调用，14 个文件），需要抽象成 `HostBridge`

---

## Section 1：三层分离 + HostBridge 抽象

### 1.1 目标

把 `packages/app` 当前同时承担的「renderer 共享代码」和「Electron shell」职责拆开，形成三层：

```
packages/app       → 共享层（features、stores、lib、components、HostBridge 接口）
packages/desktop   → Electron shell + 桌面专属 feature + ElectronHostBridge
packages/web       → PWA shell + 移动专属 feature + WebHostBridge
```

**迁移原则**：

- 现有 `packages/app/electron/*` 整体迁到 `packages/desktop/electron/*`，IPC 通道、协议不变
- 现有 `packages/app/src/*` 大部分留原地，仅做"去除 `window.electronAPI` 硬编码"的解耦重构
- 桌面专属 feature（`debug-tools`、`updater UI`）迁到 `packages/desktop/src/features/`。`floating-chat` 本 feature 暂不迁移，保留在 `packages/app/src/features/` 共享层（后续按需调整）
- 共享 feature（`chat`、`content-browser`、`agent-session-list`、`project-panel`、`welcome-page` 等）保留在 `packages/app/src/features/`，通过 `HostBridge` 能力声明决定渲染与行为
- `packages/web` 本次**只创建骨架**，PWA 实现放到后续 PR

### 1.2 目录结构

```
packages/
├── app/                         # 共享层
│   ├── src/
│   │   ├── features/            # 共享 feature（chat / content-browser / agent-session-list / project-panel / welcome-page / settings / onboarding 等）
│   │   ├── stores/              # project-data-store / streaming-store / bus-store / settings-store / side-panel-store
│   │   ├── lib/
│   │   │   ├── api.ts
│   │   │   ├── host-bridge.ts   # 新增：HostBridge 接口与 HostCapabilities
│   │   │   ├── electron-api.ts  # 保留：Electron API 的 TS 类型，供 ElectronHostBridge 实现复用
│   │   │   └── ...
│   │   ├── context/
│   │   │   ├── app-context.ts
│   │   │   ├── project-context.tsx
│   │   │   └── host-bridge-context.tsx   # 新增：HostBridgeProvider / useHostBridge()
│   │   ├── components/          # shadcn/ui + 通用展示组件
│   │   ├── layouts/             # 桌面/移动共享 layout 抽象（如有）
│   │   ├── pages/
│   │   ├── ui-sdk/
│   │   ├── router.tsx           # 共享路由表
│   │   └── main.tsx             # 共享 root（移除 electron-api 副作用 import）
│   ├── shared/
│   │   └── electron-api.ts      # IPC 契约类型，迁移到 desktop 后由 desktop re-export
│   ├── package.json
│   └── tsconfig.json
├── desktop/                     # Electron shell
│   ├── electron/
│   │   ├── main.ts              # 从 packages/app/electron/main.ts 迁入
│   │   ├── bootstrap.ts
│   │   ├── preload.ts
│   │   ├── window.ts
│   │   ├── server.ts
│   │   ├── settings.ts
│   │   ├── updater.ts
│   │   ├── sample-projects.ts
│   │   ├── ipc/                 # 全部从 packages/app/electron/ipc 迁入
│   │   └── tunnel/              # 新增（Section 2 实现内容，本 PR 仅占位）
│   ├── src/
│   │   ├── host-bridge-electron.ts   # HostBridge 的 Electron 实现
│   │   ├── features/
│   │   │   ├── debug-tools/     # 从 packages/app/src/features/debug-tools 迁入
│   │   │   └── updater-ui/      # 从 packages/app/src/features/settings/UpdateChecker.tsx 等 迁入
│   │   ├── layouts/
│   │   │   └── desktop-layout.tsx   # 桌面宽屏 layout（ActivityBar + side panel）
│   │   ├── main.tsx             # 桌面入口（注入 ElectronHostBridge）
│   │   └── index.html
│   ├── electron.vite.config.ts  # 从 packages/app/electron.vite.config.ts 迁入
│   ├── electron-builder.yml     # 从 packages/app/electron-builder.yml 迁入
│   ├── e2e/                     # 从 packages/app/e2e 迁入
│   ├── playwright.config.ts
│   ├── vitest.config.ts
│   └── package.json
└── web/                         # PWA shell（本 PR 仅占位）
    ├── src/
    │   ├── host-bridge-web.ts   # HostBridge 的 Web 实现（本 PR 仅 stub）
    │   ├── main.tsx
    │   └── index.html
    ├── public/
    │   └── manifest.webmanifest
    ├── vite.config.ts
    └── package.json
```

### 1.3 HostBridge 接口设计

**核心思路**：把现有 `ElectronAPI`（30+ 方法）拆解为「能力声明 + 实现」两层。移动端实现子集，桌面端实现全集。

```ts
// packages/app/src/lib/host-bridge.ts

export interface HostBridge {
  /** 环境标识，便于 feature 内部做兜底分支 */
  readonly kind: "electron" | "web";

  /** 服务端 baseUrl，桌面从 IPC 拿，移动从 localStorage 拿 */
  getServerBaseUrl(): Promise<string>;

  /** 能力声明，feature 据此条件渲染或调用 */
  readonly capabilities: HostCapabilities;

  /** 设置（locale/theme 等） */
  getSettings(): Promise<HostSettings>;
  saveSettings(patch: Partial<HostSettings>): Promise<void>;

  /** 通用：打开外部 URL；桌面走 shell.openExternal，移动走 window.open */
  openExternal(url: string): Promise<void>;

  /** 文件保存对话框 / 浏览器下载；桌面用 saveDialog，移动用 <a download> */
  saveBlob?(filename: string, blob: Blob): Promise<void>;

  /** 桌面独占：项目管理、sample、本地文件夹选择 */
  project?: ProjectHostApi;

  /** 桌面独占：app 更新流程 */
  updater?: UpdaterHostApi;

  /** 桌面独占：dev tools、reload、reset */
  devTools?: DevToolsHostApi;
}

export interface HostCapabilities {
  /** 是否支持添加/移除项目 */
  projectManagement: boolean;
  /** 是否支持本地文件选择（skill zip 安装等） */
  filePicker: boolean;
  /** 是否有 app 自动更新 */
  appUpdate: boolean;
  /** 是否暴露 dev tools 入口 */
  devTools: boolean;
  /** 设置编辑范围 */
  settings: { editable: boolean; scope: "local-only" | "synced" };
  /** 文件内容是否可编辑（移动端只读） */
  content: { editable: boolean };
}
```

**子接口**（`ProjectHostApi` / `UpdaterHostApi` / `DevToolsHostApi`）：直接复用现有 `ElectronAPI` 对应方法的签名，本 PR 不重新设计 API 形态，只是把它们从单一 `ElectronAPI` 拆成按职责分组的 optional 接口。示例映射：

- `ProjectHostApi` = `{ selectDirectory, selectSkillZip, openProject, restoreProjects, addOpenProject, closeProject, openProjectFolder, setLastActiveProject, getLastActiveProject, openSampleProject, getSampleManifest }`
- `UpdaterHostApi` = `{ checkForUpdates, downloadUpdate, installUpdate, cancelUpdate, getUpdateState, getAppVersion, onUpdateEvent }`
- `DevToolsHostApi` = `{ isDev, toggleDevTools, isDevToolsOpen, getElectronStoreData, reloadRenderer, resetAppData }`
- 通用方法（`getSettings` / `saveSettings` / `getSupportedProviders` / `getImageProviders` / `showSaveDialog` / `openExternal`）放 `HostBridge` 顶层，因为两端都需要（实现不同）

### 1.4 注入方式

在共享层 root 加 `HostBridgeProvider`：

```ts
// packages/app/src/context/host-bridge-context.tsx

const HostBridgeContext = createContext<HostBridge | null>(null);

export function HostBridgeProvider({ bridge, children }: {
  bridge: HostBridge;
  children: ReactNode;
}) {
  return <HostBridgeContext.Provider value={bridge}>{children}</HostBridgeContext.Provider>;
}

export function useHostBridge(): HostBridge {
  const bridge = useContext(HostBridgeContext);
  if (!bridge) throw new Error("useHostBridge must be used within HostBridgeProvider");
  return bridge;
}
```

各 shell 入口在创建 React root 时注入对应实现：

```ts
// packages/desktop/src/main.tsx
const bridge = createElectronHostBridge();  // 内部调用 window.electronAPI
createRoot(...).render(
  <HostBridgeProvider bridge={bridge}>
    <RouterProvider router={router} />
  </HostBridgeProvider>
);
```

### 1.5 迁移策略

`window.electronAPI` 当前调用按以下优先级迁移：

**P0：影响 server baseUrl 与基础可用性（必须迁）**

- `app-store.ts`：`getServerPort` → `hostBridge.getServerBaseUrl()`
- `bus-store.ts`：`getServerPort` → `hostBridge.getServerBaseUrl()`
- `settings-store.ts`：`getSettings` / `saveSettings` → `hostBridge.getSettings()` / `hostBridge.saveSettings()`
- `App.tsx`：`loadSettings(window.electronAPI)` → `loadSettings(hostBridge)`

**P1：桌面独占功能（capability 守卫，移动端不渲染）**

- `OnboardingPage.tsx`：sample manifest / openSampleProject → `hostBridge.project?.openSampleProject(...)`，capability `projectManagement=false` 时整页不渲染
- `skill-panel/index.tsx`：`selectSkillZip` → `hostBridge.project?.selectSkillZip(...)`，capability `filePicker=false` 时隐藏按钮
- `debug-tools/*`：`toggleDevTools` / `getElectronStoreData` / `reloadRenderer` / `resetAppData` → `hostBridge.devTools?.xxx`，capability `devTools=false` 时整 feature 不挂载（仅桌面入口）
- `use-update-checker.ts`：updater 相关 → `hostBridge.updater?.xxx`，capability `appUpdate=false` 时整 feature 不挂载

**P2：通用能力替代（移动端用 Web API 替代）**

- `HtmlCard.tsx`、`ImageCard.tsx`：`showSaveDialog` → `hostBridge.saveBlob(filename, blob)`
- `ContentView.tsx`、`UpdateChecker.tsx`：`openExternal` → `hostBridge.openExternal(url)`

**P3：项目管理（移动端 layout 不挂载相关入口）**

- `app-store.ts` 的 `openProject` / `closeProject` / `openProjectFolder` / `selectDirectory` / `restoreProjects` 等 → 全部通过 `hostBridge.project?.xxx` 调用
- `app-store` 本身仍留在 `packages/app/src/stores/`（最小改动），桌面 layout 挂载并使用它；移动 layout 不挂载 `app-store`，PR4 会新建独立的 `mobile-project-store`（项目列表从 `GET /api/projects` 拉）
- 因此 P3 不需要迁移 `app-store` 文件位置，只需替换其内部 `window.electronAPI` 调用为 `hostBridge.project?.xxx`

**保留**：`packages/app/src/lib/electron-api.ts`（global 声明）保留，但仅在 `packages/desktop` 入口处通过副作用 import 生效；共享层不再直接读 `window.electronAPI`。

### 1.6 `main.tsx` 的副作用清理与共享 root 工厂

当前 `packages/app/src/main.tsx` 直接 `createRoot` 并 `import "./lib/electron-api"`。迁到三层结构后：

- `packages/app/src/main.tsx` 改为「共享 root 工厂」：导出 `createAppRoot(bridge: HostBridge)` 函数，内部 `createRoot(...).render(<HostBridgeProvider bridge={bridge}><RouterProvider router={router} /></HostBridgeProvider>)`，不再直接 createRoot
- `packages/desktop/src/main.tsx`：调用 `createAppRoot(createElectronHostBridge())`，并在此处 `import "./lib/electron-api"` 让 global 类型生效
- `packages/web/src/main.tsx`：调用 `createAppRoot(createWebHostBridge())`（本 PR 仅 stub）
- `router.tsx` 本 PR 保留在共享层、桌面/移动共用同一份路由表；PR4 实现移动端时再决定是否拆分（移动端可能需要不同的 layout route）
- `index.html` 各自一份，指定各自的 `src/main.tsx` 入口

### 1.7 本 PR 不实现的部分

明确**推迟到后续 PR**：

- `packages/web` 的实际 PWA 实现（扫码、移动布局、PWA manifest、service worker）—— 本 PR 只创建空骨架与 `host-bridge-web.ts` 的 stub
- Server 端 auth、`GET /api/projects`、`/api/connection/info` —— Section 2 实现
- `cloudflared` 集成、QR 生成、`TunnelProvider` —— Section 2 实现
- 桌面 layout 的窄屏适配（如果需要）—— Section 3 实现

### 1.8 验证标准

- 桌面应用 `npm run dev` 正常启动，所有现有 E2E 用例通过
- `npm run lint` 通过
- `npm run verify`（lint + build + unit tests + i18n check）通过
- `packages/app/src` 不再出现 `window.electronAPI` 的直接引用（除 `lib/electron-api.ts` 的 global 声明文件）
- `packages/web` 能 `npm run dev` 启动一个空白 PWA（注入 stub HostBridge）

### 1.9 后续基建层 backlog：feature 可见性机制

**PR1 的设计原则**：业务代码仅做机械替换 `window.electronAPI.X` → `bridge.X?.()`，bridge 的 optional 成员（`project`/`updater`/`devTools`/`showSaveDialog` 等）通过 optional chaining 在 web 端自然 no-op。**业务代码内不写 capability 分支**——feature 在不同 host 上的可见性与挂载与否，由未来的「feature 注册表 / host 能力声明」基建层统一处理，避免每个 feature 自己 hardcode `if (bridge.capabilities.xxx)`。

**后续待做（按需推进，可能拆为独立 feature）**：

- **Feature registry / Host capability adapter**：在 shell 入口（`packages/desktop/src/main.tsx`、`packages/web/src/main.tsx`）声明该 host 提供哪些 feature、哪些路由可挂载。共享层的 `router.tsx` 接收 capability 描述后条件注册路由（如 web 不注册 onboarding 路由、不挂载 debug-tools activity bar 入口）
- **Layout 差异化**：桌面 layout（宽屏 ActivityBar + pinned/hover side panel）与移动 layout（底部 Tab + Drawer）由各 shell 自有 layout 组件表达，共享层只提供 feature 内容组件，不耦合具体 layout
- **Capability-driven `HostBridge` 实现**：web 端当 `bridge.project === undefined` 时，调用 `bridge.project?.xxx()` 的 feature 静默 no-op；未来若需更明确的「不可用」反馈，可在 bridge 加 `unsupported(reason)` 钩子，由 feature 注册表统一渲染「该功能在当前 host 不可用」占位

本 PR 不实现上述机制，仅在 §1.5 迁移时保持业务代码 capability-agnostic，为后续基建层留出干净的接入点。

---

## Section 2：Server auth + Tunnel 集成（后续 PR）

### 2.1 Bearer Token 鉴权

- 桌面 Electron 首次启动 tunnel 时生成 256-bit 随机串，存入 `AppSettings.mobileAccess.token`
- Token 通过环境变量 `SPHERSE_ACCESS_TOKEN` 注入 server
- Fastify `onRequest` 钩子校验所有 `/api/*` 与 `/ws/*`：HTTP 走 `Authorization: Bearer`，WebSocket 走 `?token=` query
- 本地来源（`127.0.0.1` / `localhost`）豁免校验，避免影响桌面 renderer
- 健康检查端点 `/health` 不校验，供 cloudflared 探测

### 2.2 新增 API 端点

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/projects` | 列出桌面已注册项目（id/name/lastOpened，path 脱敏） |
| GET | `/api/projects/:projectId/info` | 单项目元数据 |
| GET | `/api/connection/info` | server 版本、能力、auth 状态 |
| POST | `/api/skills/upload` | multipart 文件上传（替代当前 `zipPath` 路径参数） |

### 2.3 TunnelProvider 抽象

```ts
// packages/desktop/electron/tunnel/provider.ts
export interface TunnelProvider {
  readonly id: string;
  start(localPort: number): Promise<TunnelSession>;
}

export interface TunnelSession {
  readonly publicUrl: string;
  onStop(fn: () => void): void;
  stop(): Promise<void>;
}
```

Cloudflare 实现 spawn `cloudflared tunnel --url http://localhost:${port}`，解析 stdout 抓取 `*.trycloudflare.com` URL。二进制按平台打包到 `packages/desktop/resources/`。

### 2.4 二维码

QR 编码 deeplink：`spherse://connect?base=<url>&token=<token>`，移动端 PWA 通过 `url_handlers` 或入口 query 解析接收。

### 2.5 桌面 UI

"设置 > 移动端" 面板：展示 QR + Token + 「重新生成 Token」按钮 + tunnel 状态（running / url / startedAt）+ 「重启 tunnel」按钮。

---

## Section 3：移动端 PWA 实现（后续 PR）

### 3.1 功能矩阵（移动端 = 只读 + 聊天）

| Feature | 移动端 | 备注 |
|---|---|---|
| chat（流式对话、viewer card、image card、html card） | ✅ | 核心场景 |
| content-browser（看文件） | ✅ 只读 | 隐藏编辑/新建/删除 |
| **project-panel（项目切换 + 文件树）** | ✅ | **从侧边滑出（Drawer）**，支持切换项目和浏览文件 |
| agent-session-list | ✅ | 改 tab 或抽屉 |
| onboarding（扫码） | ✅ 替代为 mobile-scan feature | |
| welcome-page | ✅ | 项目首页 |
| settings（locale/theme） | ✅ 本地 localStorage | 不影响桌面 |
| floating-chat | ❌ | 移动端无浮窗需求 |
| agent-trigger 配置 UI | ❌ | 配置在桌面；但会话被 trigger 触发后照常出现 |
| skill-panel | ❌ | 桌面管理 |
| project-settings / theme editor | ❌ | |
| text-selection-session | ❌ | 桌面专属 |
| debug-tools / updater UI | ❌ | |

### 3.2 移动端布局

- **底部 Tab 栏**（替代桌面 ActivityBar 左轨）：项目 / 会话 / 设置
- **Project Panel**：从左侧滑出的 Drawer（用户需求，保留该 feature），底部 tab 「项目」打开，用于切换项目和浏览项目文件
- **主区域**：当前 session 的 chat，全屏无侧栏挤压
- **Dialog 风格**：所有 modal 改 bottom-sheet（shadcn Drawer）

### 3.3 PWA 配置

- `manifest.webmanifest`：display standalone、theme_color、icons
- service worker（`vite-plugin-pwa`）：缓存 app shell
- iOS Safari 的 WS 在 PWA 模式下可能不稳定，必要时降级 HTTP polling（后续 PR 评估）

### 3.4 Skill 安装降级

- MVP **直接砍掉移动端装 skill**（符合"只读 + 聊天"定位）
- 后续需要时新增 `POST /api/projects/:projectId/skills/upload` multipart 端点

---

## PR 拆分规划

整个移动端支持拆为 4-5 个 PR，本次只实现 PR1：

| PR | 范围 | 对应 Section |
|---|---|---|
| **PR1（本次）** | 三层目录分离 + HostBridge 抽象 + `window.electronAPI` 全量迁移 + mobile 骨架 stub | Section 1 |
| PR2 | Server auth + `GET /api/projects` + 连接信息端点 | Section 2.1-2.2 |
| PR3 | cloudflared 集成 + QR 生成 + 桌面「移动端」设置面板 | Section 2.3-2.5 |
| PR4 | 移动端 PWA 实现（扫码、布局、project-panel drawer、PWA manifest） | Section 3 |
| PR5（可选） | 移动端窄屏 UI 打磨 + iOS 兼容性 + skill 上传 | Section 3 收尾 |

PR1 详细实施计划见 `plan.md`。
