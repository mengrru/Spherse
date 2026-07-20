# Section 4：移动端 PWA 实现（PR4a）

> **对应 design：** 本文是对 `design.md` Section 3 的重写，基于 Section 1-3 落地后的现状重新梳理 PR4 的实现策略。原 Section 3 的功能矩阵、布局目标、PWA 配置仍有效，但实现路径需要按当前代码现状重做。
>
> **范围：** PR4 拆为 4a / 4b 两批。本文档只覆盖 4a（功能可用，UI 粗糙）。4b 包含 UI 打磨、bottom-sheet、PWA 完整配置、iOS WS 兜底、列表刷新策略，留到下一份文档。

---

## 1. 现状盘点

### 1.1 已就绪

- **三层分离**：`packages/app`（共享 renderer）+ `packages/desktop`（Electron shell）+ `packages/web`（PWA shell 骨架）
- **HostBridge 抽象**：`packages/app/src/lib/host-bridge.ts`；`ElectronHostBridge` 全能力实现；`WebHostBridge` stub 已就位（baseUrl/token 从 localStorage 读，`capabilities` 全关 / `content.editable: false`）
- **Section 3 feature gating**：`feature-registry` + `<FeatureGate>` + `useFeature` 按 `host.kind` 砍掉桌面专属 UI 入口（settings / agent-dialog / agent-trigger / floating-chat / text-selection-session / open-project）；复用 `capabilities.filePicker` / `capabilities.content.editable` 关掉 skill-install / file-tree-mutate / content-edit / 项目级设置子菜单
- **Server auth + tunnel**：Bearer Token 校验 + Cloudflare Quick Tunnel 已完成；`GET /api/projects`（返回 `{ id, name }[]`）、`GET /api/projects/:projectId/info`（返回 `{ id, name, rootPath }`）、`GET /api/connection/info` 均已实现
- **QR 生成**：桌面端 QR 编码 `spherse://connect?base=<url>&token=<token>`，在「设置 > 移动端」面板展示
- **`packages/web` 骨架**：vite + tailwind + react，`src/main.tsx` 注入 `WebHostBridge` 后能启动空白页

### 1.2 待做（PR4a 范围）

web 端目前能跑但什么都看不到——`/` 路由的 `OnboardingPage` 被 `<FeatureGate feature="open-project">` 砍掉，`WebHostBridge.project = undefined` 导致 `app-store.restoreProjects()` 返回空数组。需要：

1. 让 web 端能从 HTTP 拉项目列表，复用 `app-store` 走完和桌面一样的 init + 项目切换流程
2. 提供扫码 / 手动输入连接入口
3. 极简移动 layout（底部按钮开 ProjectPanel drawer，主区域渲染 Outlet）
4. 实测从扫码到聊天的完整链路

---

## 2. 关键决策

### 2.1 Router 共用，不拆

Router 结构两边完全一致（`/` → onboarding/connect；`/project/:id` → ProjectScope + 子路由）。`/` 的 element 组件 `OnboardingPage` 内部按 `bridge.kind` 分支：

- `kind === "electron"`：渲染原 `<OnboardingPageFeature>`（已被 `<FeatureGate feature="open-project">` 包裹）
- `kind === "web"`：渲染新增的 `<MobileConnectPage>`

**收益**：路由表单源；page 组件（`ProjectScope` / `ChatPage` / `ContentBrowserPage` / `WelcomePagePage`）零改动。

### 2.2 App.tsx 共用，加一处 kind 分支

`App.tsx` 当前做的事：

- `restoreProjects(bridge)` + `loadSettings(bridge)` + `busStore.init(bridge)` — 两边都需要，共用
- 渲染 `<ActivityBar>` + `<SettingsModal>` — 桌面专属

第 2 点是必须分支的证据：ActivityBar 是左轨宽屏 layout（avatar 列表 + pin 按钮 + 设置入口），不适合移动。App.tsx 内部按 `bridge.kind` 切 layout：

```tsx
{bridge.kind === "electron" ? (
  <ActivityBar ... />
) : (
  <MobileLayout />
)}
```

`MobileLayout` 放在 `packages/web/src/layouts/`，App.tsx 通过 deep import 引入（不污染共享层 barrel）。`SettingsModal` 已被 `useFeature("settings")` 守卫，web 端天然不渲染。

**不强行抽 `useAppInit` hook、不抽 shell 组件**——分支只此一处，过度抽象反而增加理解成本。

### 2.3 `app-store` 共用，无改动

关键洞察：**让 `WebHostBridge` 实现 `ProjectHostApi` 的 HTTP + localStorage 子集**，就能让 `app-store` 在 web 端透明运行，无需任何改动。

`ProjectHostApi` 方法在 web 端的实现策略：

| 方法 | web 实现 | 说明 |
|---|---|---|
| `restoreProjects()` | `fetch GET /api/projects` + 逐项 `GET /api/projects/:id/info` 拿 rootPath → 映射成 `RestoredProject[]` | rootPath 用于 theme CSS 等下游消费 |
| `getLastActiveProject()` | localStorage `spherse:last-active-project` | |
| `setLastActiveProject(id)` | localStorage `spherse:last-active-project` | |
| `selectDirectory` / `openProject` / `openSampleProject` / `closeProject` / `openProjectFolder` / `addOpenProject` / `selectSkillZip` / `getSampleManifest` | 全 no-op（返回 `null` / `undefined` / `[]`） | 对应 UI 入口都已被 capability / feature gate 砍掉，不会被调用 |

`app-store.restoreProjects()` 解构 `lastOpened` 字段做排序，但 server 不持有该信息（只存在 desktop electron-store）。两条路：

- **(A) 给 `ProjectInfo` 加 `lastOpened`**：需要让 server registry 接收 desktop 端的元数据，server 改动跨层
- **(B) web 端用 localStorage 自管排序**：`restoreProjects()` 时为每个项目填 `new Date(0).toISOString()` 占位，ActivityBar / 项目列表按 web 端 localStorage 记的「最近访问」排序

**选 (B)**：最小改动，server 不动，web 端排序独立。`app-store.ts:81` 的 `lastOpened` 字段继续保留（desktop 端正常用），web 端填占位值不影响 `setActiveProject` 的核心流程（只是排序看起来无意义，PR4a 接受这个缺陷，4b 用 localStorage 记真实访问时间修复）。

### 2.4 ProjectScope 不改造

`ProjectScope.tsx:23` 读 `useAppStore((s) => s.projects.get(projectId))`，只要 `app-store` 的 `projects` Map 有数据（2.3 保证），ProjectScope 完全不需要改。`useCustomTheme` 接收的 `projectRoot` 在 web 端是真实路径（来自 `/api/projects/:id/info` 的 `rootPath`），theme CSS 加载逻辑正常工作。

### 2.5 扫码 + 连接

QR 内容 = `spherse://connect?base=<tunnel-url>&token=<bearer-token>`。web 端**不依赖 OS-level scheme handler**（iOS PWA 基本不支持自定义 scheme），改用浏览器内扫码：

- **`MobileConnectPage`**：未连接时全屏显示「扫码连接」按钮 + 「手动输入」兜底入口
- **扫码**：优先用原生 `BarcodeDetector`（Chrome/Edge），不支持时降级到 `jsQR` + `getUserMedia`
- **解析**：从 QR 字符串解析 `base` / `token` query 参数，写入 localStorage `spherse:connection`
- **手动输入**：两个 input（baseUrl、token），用于扫码失败的兜底场景
- **写入后**：调 `app-store.restoreProjects(bridge)` 重新 init，navigate 到 `/`

### 2.6 移动 layout（极简版）

`packages/web/src/layouts/MobileLayout.tsx`，UI 极简：

- 底部固定一个「项目」按钮，点击打开 ProjectPanel drawer（复用现有 `features/project-panel`）
- 主区域：`<Outlet />`
- 不做 settings tab（settings feature 已 gate）
- 不做 bottom-sheet 风格的 Dialog（4b 再做）

ProjectPanel 在 web 端复用原组件，但容器从「桌面侧栏 hover/pin」换成「drawer 滑出」。实现方式：直接把 `<ProjectPanel />` 放进 shadcn `Drawer`/`Sheet` 组件。具体容器组件 4a 用最简单的 `Sheet`（从左侧滑出），4b 再打磨。

### 2.7 WebSocket

直接用现有 `bus-store` + `streaming-store` 的 WS 实现。加 reconnect + 心跳逻辑（如果还没有的话）。**不做 HTTP polling 兜底**——iOS Safari 实测出问题再加。

### 2.8 列表刷新

PR4a 不做主动刷新。用户切回 tab 时（`visibilitychange`）也不刷新——4b 再加。PR4a 只在首次连接时拉一次。

---

## 3. 实现范围

### 3.1 server 端

**不动**。`/api/projects`、`/api/projects/:id/info`、`/api/connection/info` 三个端点已足够 PR4a 使用。`lastOpened` 由 web 端 localStorage 自管。

### 3.2 共享层（`packages/app/src/`）

**最小改动**：

- `pages/OnboardingPage.tsx`：route adapter 内部按 `bridge.kind` 分支，web 渲染 `<MobileConnectPage>`（从 `packages/web/src/pages/` deep import）
- `App.tsx`：layout 部分（`<ActivityBar>` vs `<MobileLayout>`）按 `bridge.kind` 分支

其它文件（router.tsx、stores、features、layouts/ProjectScope）零改动。

### 3.3 web shell（`packages/web/src/`）

- `host-bridge-web.ts`：实现 `project?: ProjectHostApi`（HTTP + localStorage 子集）
- `pages/MobileConnectPage.tsx`：扫码 + 手动输入 + 连接成功后 init
- `layouts/MobileLayout.tsx`：底部「项目」按钮 + ProjectPanel drawer + Outlet

### 3.4 desktop shell

**不动**。

---

## 4. 验收标准

- `npm run dev --workspace=packages/desktop`：桌面应用行为完全不变（ElectronHostBridge 全能力 + ActivityBar layout）
- `npm run dev --workspace=packages/web`：浏览器打开后：
  - 首次访问 `/`：显示 `MobileConnectPage`（扫码 / 手动输入）
  - 扫码或输入正确 base + token 后：自动跳到项目列表（通过 ActivityBar 的 avatar 列表显示，因为 4a 还没换 MobileLayout 的项目切换 UI——见下注）
  - 点击 avatar 进入项目：能正常渲染 ProjectPanel + welcome page / chat / content browser
  - 在 chat 发消息：能收到流式回复
  - 切换项目：通过当前 layout（4a 阶段 ProjectPanel 仍以桌面形态存在，只是被 gate 砍掉了 file-tree mutation 等入口；切换项目通过点击 avatar 完成）

**注**：PR4a 的 MobileLayout 只做最小化的底部按钮 + drawer 容器。ProjectPanel 的项目切换 UI 在 4a 阶段仍走桌面现有的 avatar 列表（在 MobileLayout 里渲染）。完整的移动专属切换体验（列表样式、滑动手势）留到 4b。

- `npm run lint` / `npm run verify`：通过
- `npm test --workspace=packages/app` / `--workspace=packages/desktop`：现有测试不回归

---

## 5. 不在 PR4a 范围

明确推迟到 PR4b：

- MobileLayout 的 UI 打磨：底部多 Tab、bottom-sheet Dialog 风格、列表视觉
- PWA manifest + service worker（`vite-plugin-pwa`）
- iOS Safari WS 兼容性兜底（如需）
- 列表刷新策略（visibilitychange / pull-to-refresh）
- 移动专属项目列表 UI（取代桌面 avatar 列表）
- 移动专属 settings 入口（locale / theme 本地化，待需求确认）
- WebSocket reconnect / 心跳（如现有实现不足）
