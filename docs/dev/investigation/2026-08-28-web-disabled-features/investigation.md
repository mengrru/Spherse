# Web 端禁用 Feature 盘点与开启可行性调研

日期：2026-08-28
背景：web 端（移动 PWA）当前禁用了部分 feature，计划逐渐对齐 web 端与桌面端功能。本文盘点全部禁用点，并评估哪些可「一键无痛」开启。

## 一、平台差异的四层机制

| 机制 | 位置 | 说明 |
|---|---|---|
| HostCapabilities 能力声明 | `packages/web/src/host-bridge-web.tsx:11-20` vs `packages/desktop/src/host-bridge-electron.ts:10-19` | 6 布尔项 + settings/content 子对象 |
| feature-registry | `packages/app/src/lib/feature-registry.ts:16-26` | 9 个 feature 全部 `ELECTRON_ONLY`，经 `useFeature` / `FeatureGate` 消费 |
| optional 子 API 缺失 | `packages/web/src/host-bridge-web.tsx` | `updater` / `devTools` / `mobile` / `showSaveDialog` / `getSupportedProviders` 等不提供，调用点 optional chaining 自然 no-op；project API 逐方法 stub |
| `bridge.kind` 硬判断 | `packages/app/src/App.tsx:92`、`packages/app/src/pages/OnboardingPage.tsx:7-13` 等 | 少量直接判断 |

## 二、禁用功能全量清单

### A. 项目管理（open-project）
- `packages/app/src/pages/OnboardingPage.tsx:11-13` FeatureGate；`packages/app/src/features/activity-bar/index.tsx:39,125-135`「+ 添加项目」隐藏
- project API stub：`selectDirectory`/`openSampleProject` 返回 null，`openProject` throw（`host-bridge-web.tsx:87-161`）
- 依赖：本地文件系统 / 目录选择对话框；web 是远程客户端非组合根（`docs/official/architecture/index.md:49`）

### B. 内容只读（content.editable: false）
- `packages/app/src/features/content-browser/index.tsx:61` 编辑开关恒 false
- `packages/app/src/features/user-file-panel/index.tsx:27,49-57,73` 黑名单设置隐藏、文件树 readOnly
- `packages/app/src/features/skill-panel/index.tsx:63-64,83-93` 新建/安装 zip 隐藏、Skill 树只读
- `packages/app/src/features/activity-bar/index.tsx:41,72-86` 项目设置子菜单隐藏
- 注意：「只读」是 UI 约定，server 写 API 对 web 照常开放（如 skill marketplace 未 gate）

### C. 设置（settings）
- `packages/app/src/App.tsx:24,94-96` SettingsModal 不挂载；`activity-bar/index.tsx:38,115-124` 齿轮隐藏
- 矛盾：`WEB_CAPABILITIES.settings.editable = true` 但 registry 整体禁用 → web 无任何设置入口（backlog.md:51 已列）

### D. 自动更新（updater）/ E. 调试工具（devTools）
- web bridge 不提供子 API，调用点 optional no-op（`use-update-checker.ts:65-66`、`debug-tools/index.tsx:11-15`）
- 依赖 Electron main（`packages/desktop/electron/updater.ts`、`ipc/debug.ts`）

### F. 浮窗（floating-chat / floating-content-browser）
- `packages/app/src/layouts/ProjectRuntimeBridges.tsx:14-19` 不挂 Manager
- `SessionRow.tsx:66,179-187`、`user-file-panel/index.tsx:28,63-72` 入口隐藏
- ui-sdk action 降级：`open-chat.ts:11-18`、`float-content.ts:9-12`、`float-session.ts:20`、`open-file.ts:9-12` 等 → 页面导航
- 依赖：Electron 多窗口范式

### G. 内建浏览器（browser）
- `ProjectRuntimeBridges.tsx:20-22` 不挂 BrowserManager；`browser/open-external-url.ts:26` 不拦截
- 路由 `/project/:id/browser` 未排除（`router.tsx:38-40`），直接输 URL 会渲染不可用页面
- 依赖：server 反向代理（远程 iframe localhost 解析 + 混合内容），backlog.md:46 已列

### H. Agent 管理（agent-dialog / agent-trigger / agent-mcp）
- `AgentRow.tsx:33-35,64-96` 右键编辑/删除/触发器/MCP 隐藏；`agent-session-list/index.tsx:52,155-173` 侧栏「新建 Agent」隐藏
- TriggerEventBridge 与 Clock 指示器不 gate（已启用的触发器在 web 照常工作）

### I. 文本选择发起会话（text-selection-session）
- `content-browser/index.tsx:38,95-103` 不包 TextSelectionSession
- `useTextSelection.ts:94` 仅监听 `mouseup`，移动端长按选择未适配

### J. 系统对话框（filePicker / openFileExternal / showSaveDialog）
- `UnsupportedFileCard.tsx:31-36` 系统打开隐藏；`HtmlCard.tsx:107-111`、`ImageCard.tsx:26-33` 保存按钮渲染但静默失败
- web 已实现 `saveBlob`（`host-bridge-web.tsx:181-190`）但无调用方（待接线）

### K. 移动访问管理（mobileAccess）
- settings mobile tab 隐藏 + `bridge.mobile` 不提供；cloudflared tunnel 编排属 desktop main

## 三、开启可行性分级

### 一键无痛（翻 feature-registry 即可，底层全走 server HTTP API，零 bridge 依赖）

三个 feature 已于 2026-08-28 开启（`feature-registry.ts` 翻为 `ALL_HOSTS`）。

| Feature | 验证结论 | 残留注意点 |
|---|---|---|
| **agent-dialog** | `AgentDialog.tsx`/`AgentDialogForm.tsx` 仅用 `useApiClient`（server API）+ `@spherse/presets` + UI 组件，无任何 host bridge 调用 | 「新建 Agent」有独立入口（侧栏 `…` DropdownMenu，点按可用）；但**编辑/删除 agent 的唯一入口是 AgentRow 右键 ContextMenu**（`AgentRow.tsx:64-96`），移动端依赖长按（Base UI ContextMenu 原生支持 500ms 长按），未真机验证 |
| **agent-trigger** | `agent-trigger/` 目录零 bridge 依赖，CRUD 走 server API；TriggerEventBridge 本就跨平台运行 | **触发器配置的唯一入口是 AgentRow 右键 ContextMenu**（`AgentRow.tsx:69-74`），同上依赖长按；TriggerList/TriggerForm 为桌面表单 UI，窄屏可用性需过一遍 |
| **agent-mcp** | `McpDialog.tsx:114` → `client.updateAgentMcp` → server `req.projectCtx.runtime.updateAgentMcp`（`packages/server/src/routes/agent-mcp.ts:33`），纯 server 侧生效，desktop 无 IPC 参与 | **MCP 配置的唯一入口是 AgentRow 右键 ContextMenu**（`AgentRow.tsx:75-79`），同上依赖长按 |

### 小量适配可开（非一键，改动小）

| Feature | 缺口 |
|---|---|
| settings | modal 依赖 web 全部已有（getSettings/saveSettings → localStorage；updater optional no-op；mobile tab 已被 capability 隐藏）。**关键缺口**：`HostSettings.models`（API key）在 desktop 由 electron-store → server 启动读取（`packages/desktop/electron/server.ts:20-25`），web 存 localStorage 不会到达 server → 直接开会误导用户。需按 `capabilities.settings.scope: "local-only"` 过滤 tabs（只留 theme/locale/help） |
| HtmlCard/ImageCard 保存 | 把 `showSaveDialog` 缺失时的降级接到 web 已实现的 `saveBlob`，几行代码 |
| text-selection-session | 纯 UI gate，但 `mouseup` 监听与桌面式 popover UX 在移动端需适配 `selectionchange`/长按 |

### 架构上不可一键（需新底层能力或产品范式不同）

| Feature | 阻塞 |
|---|---|
| open-project | web 是远程客户端非组合根，无本地文件系统；backlog.md:50 已列「移动专属项目列表」方向 |
| floating-chat / floating-content-browser | Electron 多窗口范式，移动端无此交互 |
| browser | 需 server 反向代理（backlog.md:46） |
| debug-tools | 依赖 Electron main devTools IPC |
| updater / mobileAccess(tunnel 管理) | 本质是 Electron main 能力；web 自身就是 tunnel 客户端 |

### 产品决策类

| Feature | 说明 |
|---|---|
| content.editable | 技术上一键可翻（server 写 API 对 web 本就开放），但「web = 只读 + 聊天」是设计决策（`docs/dev/features/2026-07-20-mobile-app/design.md` §3.1），且移动端编辑器 UX 未验证 |

## 四、顺带发现的漂移与边角问题

1. **capability 声明与消费漂移**：`projectManagement` / `appUpdate` / `devTools` / `settings.editable/scope` 在 app 源码零消费，实际 gating 靠 feature-registry 或 optional API 缺失。**已修（2026-08-28）**：双机制保留（capabilities 表达能力程度、feature-registry 表达 feature × 宿主矩阵，语义正交），删除全部零消费字段，分工契约写入 `docs/official/architecture/frontend.md`，`host-capabilities.structure.test.ts` 钉住「声明即必须被消费」
2. **settings 矛盾**：capability 声明 `editable: true` 但 registry 整体禁用。**已随 #1 消解**：零消费的 `settings` capability 已删除；开启 settings 时按「小量适配」节方案重新设计 scope 过滤
3. **「只读」非服务端强制**：skill marketplace 等写 API 在 web 照常可用（入口未 gate）；desktop renderer 与 web 持同一 token，server 无法区分。**2026-08-28 确认符合预期**（token 持有者 = 受信的信任模型，UI gate 只做交互约束不做安全边界）
4. **browser 路由未排除**：web 直接输 `/project/:id/browser` 会渲染实际不可用的全页浏览器。**已修（2026-08-28）**：BrowserPage 内 `useFeature("browser")` gate，不可用宿主 redirect 回项目首页
5. **web `saveBlob` 无调用方**：疑似待接线的保存降级路径。**已修（2026-08-28）**：HtmlCard / ImageCard 在 `showSaveDialog` 缺失时降级走 `saveBlob`（ImageCard 经 previewUrl fetch 取 blob），web 上保存/导出改为下载到本机设备
