# 新用户引导页设计

日期：2026-06-28
关联 backlog：`docs/dev/backlog.md:28` — `项目创建向导：HomePage 区分"新建项目"和"打开项目"`

## 背景

当前应用在没有任何项目打开时，`/` index 路由渲染 `packages/app/src/components/EmptyState.tsx`（15 行）：仅显示 "Spherse" 标题与一句「点击左侧 + 打开项目」提示，没有任何引导动作、没有创建入口、没有示例内容。新用户落地后不知如何开始。

现状关键事实（来自代码探查）：

- **打开项目流程**：`App.tsx` 的 `handleAddProject`（`packages/app/src/App.tsx:62-68`）调用 `app-store.openProject()`（`packages/app/src/stores/app-store.ts:63-89`），后者经 `electronAPI.selectDirectory()` 选目录 → `electronAPI.openProject(dir)` → server `ProjectRegistry.register()`（`packages/server/src/registry.ts:25-44`）→ core `createProject()`（`packages/core/src/factory.ts:11-51`）。core 的 `createProject` 是「open-or-create」：若目录缺 `.spherse/project.yaml` 则脚手架一个新项目，否则按 existing project 打开。
- **没有独立的「创建项目」流程**：无 `create-project` IPC、无 UI 区分「新建/打开」。ActivityBar「+」只走 `openProject()`。
- **没有示例项目概念**：全仓库无 sample/example/Harry Potter 相关代码、资源或文档。presets 包（`packages/presets/`）仅含 agent 模板、prompt 模板、builtin skills，不含完整项目目录树。
- **`showSaveDialog` IPC 已存在**：`packages/app/electron/ipc/project.ts:67-75`，当前用于其它场景，可复用。
- **i18n**：`empty-state.openProject`（`packages/i18n/src/locales/zh-CN.ts:401`）是唯一现存的空状态文案。
- backlog 第 28 行有未完成条目「项目创建向导」，与本需求相关。

## 目标

1. 无项目打开时，`/` 路由显示引导页，提供三个明确动作：**从已有项目打开**、**创建新项目**、**打开示例项目（Harry Potter）**。
2. 「创建新项目」：弹文件浏览器让用户选定（并命名）一个新文件夹位置，创建后自动脚手架并打开。
3. 「打开示例项目」：弹文件浏览器让用户选择存放位置（父目录），将内置的 Harry Potter 示例项目拷贝到该位置的一个新子文件夹并打开。
4. 示例项目机制与内容解耦：本期交付机制 + 最小占位内容，丰富内容由后续手动填充。
5. 离线可用：示例内容 app 内置，无需运行时联网。

## 非目标

- **不做**项目名/默认模型选择向导（backlog 第 28 行后半「支持设置项目名和默认模型」留待后续）。
- **不改** ActivityBar「+」按钮行为（仍为 openExisting），本需求范围限于引导页。
- **不做**示例项目的远程下载/更新机制。
- **不与**项目级 `WelcomePage`（`features/welcome-page/`，项目内可定制欢迎页）功能混淆——那是项目内配置，非新用户引导。
- **不处理**示例 yaml id 碰撞（见「已知限制」）。

## 需求对齐与假设

| 决策点 | 结论 | 理由 |
|---|---|---|
| 示例交付方式 | App 内置 + 本地拷贝 | 离线可用，体积可控（文本为主） |
| 「创建新项目」范围 | 选位置 + 自动脚手架 | 复用 core 现有 open-or-create，最简 |
| 示例内容范围 | 机制 + 最小占位 | 丰富内容由用户后续手填 `packages/presets/sample-projects/harry-potter/` |
| 示例物化逻辑归属 | **Electron main**（非 core、非 server） | 与现有约定一致：main 独占所有文件系统编排（dialog、fs、settings），server 仅负责 `register(path)`。拷贝是 fs prep，与「选目录/mkdir/addOpenProject」同属编排范畴，放 main 与 `openProject` 流程（main 选目录 → server 注册）模式统一 |
| core 是否改动 | **不改** | 示例经现有 `registerProject()` 按 existing project 打开即可，core 不感知「示例」概念 |
| server 是否改动 | **不改** | main 直接复用现有 `registerProject(path)` 导出，server 不感知「示例」、不新增方法 |
| 跨平台拷贝实现 | Node `fs.cpSync(src, dest, {recursive:true})`（在 main 执行） | shell `cp` 在 Windows 不存在；`fs.cpSync` mac/win 通用 |
| 示例运行时物理形态 | 物理目录（electron-builder `extraResources`） | 支持未来二进制资产（图片）；字面意义的目录拷贝 |
| id 碰撞处理 | 接受为 v1 已知限制 | 见下 |

## 已知限制

**示例 yaml id 碰撞**：内置示例 `.spherse/project.yaml` 含固定 `id`。若用户多次「打开示例项目」（生成 `harry-potter/`、`harry-potter-2/` …），多份拷贝共享同一 id。`app-store` 的 `projects: Map<string, ProjectState>` 以 projectId 为 key，同 id 会发生 Map key 碰撞（后者覆盖前者）。

v1 处理：**接受为已知限制**，文档记录。理由：示例 yaml id 原样拷贝、不做初始化是本设计的核心简化；多次开达示例属罕见边界 case。若后续证明需要，可在 main 拷贝后改写 yaml id（但会让 main 知晓 project.yaml 格式，轻微泄漏 core 知识），不纳入本期。

## 方案比较（示例物化路径）

| | 方案 A（本次选择） | 方案 B | 方案 C |
|---|---|---|---|
| 物化逻辑位置 | **Electron main** 内联 `fs.cpSync` + 现有 `registerProject(target)` | server 新增 `copyAndRegister(srcDir, targetDir)` | core 新增 `createProjectFromBundle` |
| core 改动 | 无 ✅ | 无 ✅ | 新增函数 ❌ |
| server 改动 | 无 ✅（复用现有 `registerProject` 导出） | 新增方法 ❌ | 取决于是否经 server |
| 与现有 `openProject` 流程一致性 | 一致 ✅（main 做所有 fs 编排，server 只 `register`） | 破坏现有分工（server 开始做 fs prep）❌ | — |
| 约定一致性 | main 独占资源路径/dialog/fs/settings 编排 ✅ | main 当前不直接 reach into `serverHandle`，需新增导出或破封装 ❌ | 违反「core 不感知示例」 ❌ |

**选择方案 A**：core 与 server 双零改动；main 独占所有文件系统编排，与现有 `openProject`（main `selectDirectory` → server `register`）模式完全一致。拷贝只是 mkdir 之外的又一项 fs prep，与 dialog、addOpenProject 等同属编排范畴，co-locate 在 main 最自然。

## 架构总览

```
[OnboardingPage (renderer)]
   ├─ openExisting ─→ app-store.openProject()           (现有, selectDirectory + register)
   ├─ createNew ────→ app-store.createNewProject()      (新, showSaveDialog + mkdir + register[core 脚手架])
   └─ openSample ───→ app-store.openSampleProject(id)   (新, showOpenDialog[父目录] + cpSync + register)
```

> core / server 均零改动；main 独占所有文件系统编排（dialog、mkdir、cpSync、settings），与现有 `openProject` 流程一致。

数据流（以「打开示例」为例）：

```
OnboardingPage → openSampleProject("harry-potter")
  → electronAPI.openSampleProject({ sampleId })                 [IPC: renderer → main，仅传 sampleId]
    → main 读取 manifest → 解析 srcDir (app.isPackaged ? resourcesPath : dev 源路径)
    → main dialog.showOpenDialog(openDirectory) → parentDir      [父目录由 main 弹窗获取]
    → main 计算 targetDir = join(parentDir, displayName) (+ -2/-3 去重)
    → main fs.mkdirSync(targetDir, {recursive:true})
    → main fs.cpSync(srcDir, targetDir, {recursive:true})        [拷贝在 main 执行]
    → main registerProject(targetDir)                            [main → server，复用现有导出 → core existing-project 路径，不脚手架]
    → main addOpenProject + setLastActive                        [main → electron-store]
    → return { projectId, path } | { error }                     [IPC: main → renderer]
  → app-store 写入 projects Map + setActive
App.tsx → navigate(`/project/${projectId}`)
```

## 数据模型

无新增持久化模型。复用现有：

- `app-store.ProjectState`（`packages/app/src/stores/app-store.ts:5-12`）：新项目拷贝/脚手架后照常构造。
- `electron-store` 的 `openProjects` / `lastActiveProject`（`packages/app/electron/settings.ts`）：照常持久化。
- 示例项目本身是一个**完整的项目目录树**，含 `.spherse/project.yaml`（带 id）、`.spherse/agents/`、根文档、`AGENTS.md`。

新增的运行时结构（仅 main 进程内存）：

```ts
// packages/app/electron/sample-projects.ts（新）
interface SampleManifestEntry {
  id: string;          // "harry-potter"
  displayName: string; // "Harry Potter"，用作拷贝出的子文件夹名
  dirName: string;     // "harry-potter"，resources 内的物理目录名
}
// 从 resources/sample-projects/manifest.json 读取
```

## presets 打包（机制，内容无关）

**源目录（内容之源，用户后续在此编辑丰富内容）**：

```
packages/presets/sample-projects/
├── manifest.json                       # [{ "id": "harry-potter", "displayName": "Harry Potter", "dirName": "harry-potter" }]
└── harry-potter/                       # 一个完整项目目录树
    ├── .spherse/
    │   ├── project.yaml                # 含固定 id（已知限制：拷贝时原样保留）
    │   └── agents/
    │       └── <themed-agent>/profile.md   # 最小占位：1 个哈利波特主题 agent
    ├── AGENTS.md
    └── <sample-doc>.md                 # 最小占位：1 篇示例世界观文档
```

> 机制与内容解耦：whatever 用户后续往 `harry-potter/` 放什么文件（含图片等二进制），重建打包后都会被原样拷进 app resources、原样落到用户磁盘。本期仅交付最小占位以便联调与测试。

**打包机制**：在 `packages/app/electron-builder.yml` 新增 `extraResources`，把 presets 的 sample-projects 目录原样拷进打包后的 `resources/sample-projects/`：

```yaml
extraResources:
  - from: ../presets/sample-projects
    to: sample-projects
    filter: ["**/*"]
```

**运行时路径解析**（main 进程）：

- 打包后：`path.join(process.resourcesPath, "sample-projects")`
- 开发态：`app.isPackaged === false` 时指向源目录 `packages/presets/sample-projects`（经相对路径解析，plan 阶段确认具体锚点，如 `app.getAppPath()` 之上回溯）。

## core 层 / server 层

**均零改动。**

- **server**：main 直接复用现有 `registerProject(path)` 导出（`packages/app/electron/server.ts:23-27`），不新增方法、不 reach into `serverHandle`。server 保持「纯项目注册层」职责，与现有 `openProject` 流程一致。
- **core**：示例经现有 `registerProject()` → `ProjectRegistry.register()` → core `createProject()` 打开。因示例目录已含 `.spherse/project.yaml`，core 走 existing-project 路径（`ProjectStore.open()` 成功），**不**触发脚手架与 `initPresets()`，示例自带的 agent/文档原样保留。

「创建新项目」同样经现有 `register()` 路径——用户选定的空目录缺 `.spherse/`，core 自动脚手架。

## Electron main / IPC

`packages/app/electron/ipc/project.ts` 新增两个 channel，并在 `packages/app/electron/preload.ts` 与 `packages/app/shared/electron-api.ts` 同步暴露。**main 独占所有文件系统编排**（dialog、mkdir、cpSync、settings），server 只承担 `registerProject(path)`。

### `create-new-project`（创建新项目）

```
main:
  dialog.showSaveDialog(win, { title: t("onboarding.dialog.newProjectLocation"), defaultPath: "新建项目" })
  → targetPath (用户命名的新文件夹) | null
  若 targetPath 已存在且非空 → return { error: "dirExistsNotEmpty" }
  fs.mkdirSync(targetPath, { recursive: true })
  registerProject(targetPath)                              [现有导出 → core 脚手架]
  addOpenProject(projectId, targetPath) + setLastActive
  return { projectId, path } | { error }
```

- 复用已存在的 `show-save-dialog` IPC 或新增专用 channel（plan 阶段定；倾向新增专用 channel 以承载「已存在且非空」校验逻辑，避免污染通用 save dialog）。
- 错误返回结构化对象（非 string），renderer 内联展示。

### `open-sample-project({ sampleId })`（打开示例项目）

```
main:
  读取 resources/sample-projects/manifest.json → 找到 sampleId 对应 entry { displayName, dirName }
  srcDir = join(resourcesRoot, "sample-projects", entry.dirName)
  dialog.showOpenDialog(win, { properties: ["openDirectory"], title: t("onboarding.dialog.sampleLocation") })
  → parentDir | null
  targetDir = join(parentDir, entry.displayName)
  若 targetDir 已存在 → 追加后缀 -2/-3/… 直至不冲突
  fs.mkdirSync(targetDir, { recursive: true })
  fs.cpSync(srcDir, targetDir, { recursive: true })        [拷贝在 main 执行，跨平台]
  registerProject(targetDir)                               [现有导出 → core existing-project 路径，不脚手架]
  addOpenProject(projectId, targetDir) + setLastActive
  return { projectId, path } | { error }
```

- 「打开示例」用 `showOpenDialog(openDirectory)` 选**父目录**，子文件夹由示例 displayName 自动命名（用户无需起名）。
- 目录冲突用后缀递增，避免覆盖用户已有同名目录。
- 不新增 `showMessageBox`（YAGNI）；错误经返回值由 renderer 展示。
- `fs.cpSync`（Node 16.7+）替代 shell `cp`，mac/win 通用。

### IPC 接口（`packages/app/shared/electron-api.ts`）

```ts
// ElectronAPI 新增
createNewProject: () => Promise<{ projectId: string; path: string } | { error: string } | null>;
openSampleProject: (opts: { sampleId: string })
  => Promise<{ projectId: string; path: string } | { error: string } | null>;
getSampleManifest: () => Promise<SampleManifestEntry[]>;   // 供 renderer 渲染示例卡片列表
```

`getSampleManifest` 让 renderer 动态获取可用示例清单（为未来多示例扩展留口，本期仅 harry-potter 一条），main 从 manifest.json 读取返回。

## 前端设计

### 路由

`packages/app/src/router.tsx`：index 路由由 `<EmptyState />` 改为 `<OnboardingPage />`。删除 `packages/app/src/components/EmptyState.tsx`。

### 新 feature 目录

`packages/app/src/features/onboarding/`：

- `OnboardingPage.tsx`（feature root，自治）：从 store 读取示例清单、调用 actions、自构造行为。三张操作卡片，shadcn semantic token（`bg-card`/`bg-primary`/`text-foreground` 等），逻辑属性（`ps-*`/`pe-*`），无硬编码颜色、无 `dark:` 修饰符。
- 卡片行为：点击 → 调用对应 app-store action → 成功后由 `App.tsx` 的 handler `navigate(/project/${id})`（与现有 `handleAddProject` 一致）；失败 → 卡片内/附近内联展示 `onboarding.error.*` 文案。

### app-store 新增 actions（`packages/app/src/stores/app-store.ts`）

镜像现有 `openProject()` 的结构（dialog 在 main 侧，renderer action 只负责调 IPC + 更新 Map + setActive）：

```ts
createNewProject: () => Promise<string | null>;            // 返回 projectId 或 null
openSampleProject: (sampleId: string) => Promise<string | null>;
```

内部：调 `electronAPI.createNewProject()` / `openSampleProject({sampleId})` → 解构 `{projectId, path}` → 构造 `ProjectState`（同 `openProject` 现有逻辑：build baseUrl、derive name from basename、加入 Map、setActive）→ 返回 projectId。失败/取消返回 null。

### App.tsx 编排

新增 `handleCreateNew` / `handleOpenSample`（与 `handleAddProject` 同构：调 store action → 成功 `navigate`）。无需新 effect，沿用现有「关闭最后一个项目后回 `/`」的导航行为即满足「无项目时显示引导页」。

### 显示时机

- projects Map 为空时 `/` 渲染 OnboardingPage。
- 关闭最后一个项目后 `App.tsx` 现有逻辑已 `navigate("/")`，自动回到引导页。无需额外条件。

## i18n

`packages/i18n/src/locales/zh-CN.ts` 为基准（每条带场景注释），新增 `onboarding.*` 命名空间，并同步 `zh-TW.ts` / `en.ts`：

| key | zh-CN（示例，含场景注释） |
|---|---|
| `onboarding.title` | Spherse（引导页主标题） |
| `onboarding.subtitle` | 开始你的世界观创作（副标题） |
| `onboarding.action.openExisting` | 从已有项目打开 |
| `onboarding.action.createNew` | 创建新项目 |
| `onboarding.action.openSample` | 打开示例项目：{name}（{name}=Harry Potter，参数插值） |
| `onboarding.desc.openExisting` | 打开一个已有的 Spherse 项目文件夹 |
| `onboarding.desc.createNew` | 选择位置并创建一个新项目 |
| `onboarding.desc.openSample` | 将内置示例项目拷贝到选定位置并打开 |
| `onboarding.dialog.newProjectLocation` | 选择新项目的创建位置 |
| `onboarding.dialog.sampleLocation` | 选择示例项目的存放位置 |
| `onboarding.error.dirExistsNotEmpty` | 该目录已存在且非空，请选择其它位置 |
| `onboarding.error.createFailed` | 创建项目失败，请重试 |
| `onboarding.error.copyFailed` | 拷贝示例项目失败，请重试 |
| `onboarding.error.sampleNotFound` | 找不到内置示例，请重新安装应用 |

删除不再使用的 `empty-state.openProject`（或保留以备它用，plan 阶段定）。

## 涉及文件

| 层 | 文件 | 变更 |
|---|---|---|
| presets | `packages/presets/sample-projects/manifest.json`（新） | 示例清单 |
| presets | `packages/presets/sample-projects/harry-potter/**`（新） | 完整项目树（最小占位内容） |
| app 打包 | `packages/app/electron-builder.yml` | 新增 `extraResources` 拷贝 sample-projects |
| server | — | **零改动** |
| core | — | **零改动** |
| app/main | `packages/app/electron/sample-projects.ts`（新） | manifest 读取 + 资源路径解析（dev/packaged） |
| app/main | `packages/app/electron/ipc/project.ts` | 新增 `create-new-project`、`open-sample-project`、`get-sample-manifest` channel（含 `fs.mkdirSync` / `fs.cpSync` 编排） |
| app/main | `packages/app/electron/preload.ts` | 暴露上述 IPC |
| app/shared | `packages/app/shared/electron-api.ts` | `ElectronAPI` 新增方法 + `SampleManifestEntry` 类型 |
| app/renderer | `packages/app/src/features/onboarding/OnboardingPage.tsx`（新） | 引导页组件 |
| app/renderer | `packages/app/src/router.tsx` | index 路由 → `<OnboardingPage/>` |
| app/renderer | `packages/app/src/stores/app-store.ts` | 新增 `createNewProject` / `openSampleProject` actions |
| app/renderer | `packages/app/src/App.tsx` | 新增 `handleCreateNew` / `handleOpenSample` |
| app/renderer | `packages/app/src/components/EmptyState.tsx` | **删除** |
| i18n | `packages/i18n/src/locales/zh-CN.ts` / `zh-TW.ts` / `en.ts` | 新增 `onboarding.*` keys |

## 测试策略

- **core**：无改动，无新增测试。
- **server**：无改动，无新增测试。
- **app/main**：`sample-projects.ts` 的 manifest 读取与 dev/packaged 路径解析单测；IPC channel 行为（mock `registerProject`/dialog/`fs`）——覆盖 mkdir、cpSync、目录冲突后缀递增、`dirExistsNotEmpty` 错误分支。
- **app/renderer**：`app-store` 新 action 的状态流转测试（mock `electronAPI`）；`OnboardingPage` 渲染三卡片 + 点击触发对应 action。
- **E2E（合并前按影响面选跑）**：从引导页走通「打开示例项目」路径（涉及项目创建、路由、store、IPC，优先级高）。「创建新项目」「从已有项目打开」可按需补。

## 验收标准

1. 无任何项目打开时，`/` 路由显示引导页，含三张操作卡片。
2. 「从已有项目打开」行为与现有 ActivityBar「+」一致。
3. 「创建新项目」弹出文件浏览器（save dialog），用户命名新文件夹后：在该位置 mkdir + core 脚手架 + 自动打开该项目。
4. 「打开示例项目」弹出文件浏览器（open directory）选父目录后：创建 Harry Potter 子文件夹（冲突时加后缀），拷贝内置示例，打开后可见示例自带 agent 与文档。
5. 目标位置已存在且非空时（创建新项目场景）给出 `dirExistsNotEmpty` 错误并中止。
6. 三语言文案齐备（zh-CN / zh-TW / en）。
7. `npm run verify` 通过（lint + build + 单测 + i18n check）。
