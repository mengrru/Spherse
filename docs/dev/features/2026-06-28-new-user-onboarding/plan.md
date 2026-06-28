# 实施计划：新用户引导页（v1）

对应 design：`docs/dev/features/2026-06-28-new-user-onboarding/design.md`

## 依赖图（箭头 = B 需 A 完成才能开工）

```
T2 main 管线 ──→ T4 store actions ──→ T6 OnboardingPage + 路由 ──→ T7 文档 + 验证
T5 i18n keys ──────────────────────────┘
T1 presets 内容 ─┐  无下游代码依赖（仅 T7 dist/手动验证需要内容存在）
T3 builder 配置 ─┘
```

## 并行批次（subagent-driven 调度参考）

- **批次 A（全并行）**：T1、T2、T3、T5（彼此无代码依赖）
- **批次 B**：T4（依赖 T2）
- **批次 C**：T6（依赖 T4 + T5）
- **批次 D**：T7（依赖 T6）

> core / server 均零改动（见 design「方案比较」）。全部 task 在 `packages/presets`、`packages/app`、`packages/i18n` 内。

---

## T1 — presets：示例项目内容（manifest + 最小占位项目树）

**文件**（新建）：
- `packages/presets/sample-projects/manifest.json`
- `packages/presets/sample-projects/harry-potter/.spherse/project.yaml`
- `packages/presets/sample-projects/harry-potter/.spherse/agents/worldbuilding-hp-abc123/profile.md`
- `packages/presets/sample-projects/harry-potter/AGENTS.md`
- `packages/presets/sample-projects/harry-potter/world-overview.md`（示例世界观文档）

**做什么**：
- `manifest.json`：
  ```json
  [
    { "id": "harry-potter", "displayName": "Harry Potter", "dirName": "harry-potter" }
  ]
  ```
- `project.yaml`（格式匹配 core 写出 shape，见 `packages/core/src/store/project.ts:61-72`；参考 `ProjectConfig` `{ id, name, created, defaultModel }`）：
  ```yaml
  id: hp-sample01
  name: Harry Potter
  created: 1719500000000
  defaultModel: gemini-2.5-pro
  ```
  > `id` 固定值（design 已知限制：多次开达示例会碰撞 projectId，本期接受）。
- agent 目录名格式 `{slug}-{shortId}`（匹配 `project.ts:152-153`，shortId 取 6 位）；`profile.md` 用 gray-matter frontmatter（匹配 `agent-profile.ts:74-80`，**必须**含 `name`，否则 `read()` 返回 null 被跳过）。frontmatter 写齐 `name`/`id`(任意 uuid)/`createdAt`(数字时间戳) + markdown 正文（哈利波特主题世界观创作助手简介）。
- `AGENTS.md`：哈利波特主题的目录索引（参考 `project.ts:24-31` 默认模板，替换为示例内容）。
- `world-overview.md`：一篇简短的哈利波特世界观示例文档（霍格沃茨四学院、主要角色等，几百字即可）。
- 内容语言：中文（与项目工作语言一致）。

**验证**：确认目录结构正确；`npm run build --workspace=packages/presets` 不报错（本 task 不改 codegen，build 产物不含 sample-projects，仅确认源文件就位无语法问题）。

**依赖**：无

---

## T2 — app/main + shared：示例管线（sample-projects.ts + IPC + preload + 类型）

**文件**：
- `packages/app/shared/electron-api.ts`（改：加 `SampleManifestEntry` 类型 + 3 个 ElectronAPI 方法）
- `packages/app/electron/sample-projects.ts`（新建：manifest 读取 + 资源路径解析）
- `packages/app/electron/ipc/project.ts`（改：加 3 个 IPC handler）
- `packages/app/electron/preload.ts`（改：暴露 3 个 IPC）

**做什么**：

**shared/electron-api.ts**（类型契约层，main/renderer 共享）：
- 新增并 export 类型：
  ```ts
  export interface SampleManifestEntry {
    id: string;          // "harry-potter"
    displayName: string; // "Harry Potter"，拷贝出的子文件夹名
    dirName: string;     // "harry-potter"，resources 内物理目录名
  }
  ```
- `ElectronAPI` 接口新增：
  ```ts
  createNewProject: () => Promise<{ projectId: string; path: string } | { error: string } | null>;
  openSampleProject: (opts: { sampleId: string })
    => Promise<{ projectId: string; path: string } | { error: string } | null>;
  getSampleManifest: () => Promise<SampleManifestEntry[]>;
  ```
  > `null` = 用户取消；`{ error }` = 错误（error 为 i18n key 后缀，如 `"dirExistsNotEmpty"`）；`{ projectId, path }` = 成功。

**electron/sample-projects.ts**（manifest 读取 + 路径解析）：
- `import type { SampleManifestEntry } from "@shared/electron-api.js"`
- `getSampleProjectsRoot(): string`：解析 sample-projects 物理根目录
  - 打包后（`app.isPackaged`）：`path.join(process.resourcesPath, "sample-projects")`（与 T3 extraResources 的 `to` 对齐）
  - 开发态：解析到 presets 源目录。**实现时需确认锚点**——推荐 `path.resolve(app.getAppPath(), "..", "presets", "sample-projects")`；若 dev 下 `getAppPath()` 不指向预期位置，改用 `fileURLToPath(import.meta.url)` 相对推导。实现者加一行 `console.log` 打印实际解析路径，`npm run dev` 启动后确认指向 `packages/presets/sample-projects`。
- `readSampleManifest(): Promise<SampleManifestEntry[]>`：读 `join(root, "manifest.json")` → `JSON.parse` → 返回；读取失败返回空数组并 log（不抛）。
- `resolveSampleSrcDir(entry): string`：`join(root, entry.dirName)`。

**electron/ipc/project.ts**（参考现有 handler 风格，`ipcMain.handle`）：
- `create-new-project`：
  1. `dialog.showSaveDialog(win, { title, defaultPath: "新建项目" })`
  2. canceled → `return null`
  3. `targetPath` 已存在且非空（`fs.readdirSync(targetPath).length > 0`，先 `existsSync`）→ `return { error: "dirExistsNotEmpty" }`
  4. `fs.mkdirSync(targetPath, { recursive: true })`
  5. `registerProject(targetPath)`（现有导出，`electron/server.ts:23-27`，内部 core 脚手架）
  6. `addOpenProject(projectId, targetPath)` + `setLastActiveProject(projectId)`
  7. `return { projectId, path: targetPath }`
  8. 整体 try/catch → 异常 `return { error: "createFailed" }`
- `open-sample-project({ sampleId })`：
  1. `readSampleManifest()` 找 sampleId 对应 entry；未找到 → `return { error: "sampleNotFound" }`
  2. `srcDir = resolveSampleSrcDir(entry)`；`!existsSync(srcDir)` → `return { error: "sampleNotFound" }`
  3. `dialog.showOpenDialog(win, { properties: ["openDirectory"], title })` → `parentDir`
  4. canceled → `return null`
  5. `targetDir = join(parentDir, entry.displayName)`；若 `existsSync` 则循环追加 `-2`/`-3`… 直至不冲突
  6. `fs.mkdirSync(targetDir, { recursive: true })`
  7. `fs.cpSync(srcDir, targetDir, { recursive: true })`
  8. `registerProject(targetDir)`（core existing-project 路径，不脚手架）
  9. `addOpenProject` + `setLastActiveProject`
  10. `return { projectId, path: targetDir }`
  11. 整体 try/catch → 异常 `return { error: "copyFailed" }`
- `get-sample-manifest`：`return await readSampleManifest()`

**preload.ts**：新增 3 行 `ipcRenderer.invoke(...)`（参考现有 `openProject`/`showSaveDialog` 写法），加到 `satisfies ElectronAPI` 对象内。

**i18n in main**：dialog `title` 是用户可见文案，main 无 React context。方案：从 `settings.ts` 的 `getSettings()` 读 locale（AppSettings 已存 locale），用 `import { translate } from "@spherse/i18n"`（core/server 已如此用，见 `App.tsx:14`）取 `onboarding.dialog.newProjectLocation` / `onboarding.dialog.sampleLocation`。

**验证**：`npm run lint --workspace=packages/app` + `npm run build --workspace=packages/app`

**依赖**：无（代码层独立；联调需 T1 内容、T5 文案存在）

---

## T3 — app 打包：electron-builder extraResources

**文件**：`packages/app/electron-builder.yml`

**做什么**：
- 在 yml 末尾新增：
  ```yaml
  extraResources:
    - from: ../presets/sample-projects
      to: sample-projects
      filter: ["**/*"]
  ```
- `from` 相对 electron-builder.yml 所在目录（`packages/app`），`../presets/sample-projects` 即 T1 源目录；`to` 相对打包后 `resources/`，运行时经 `process.resourcesPath/sample-projects` 访问（与 T2 打包路径一致）。

**验证**：yml 语法正确（`npm run dist` 实际打包验证留到 T7，本期 dev 不依赖）。

**依赖**：无（代码层独立；`npm run dist` 时需 T1 源目录存在，由 T7 覆盖）

---

## T4 — app/renderer：app-store 新 actions

**文件**：`packages/app/src/stores/app-store.ts`

**做什么**：
- `AppStore` 接口新增（镜像现有 `openProject()` 结构，见 `app-store.ts:63-89`）：
  ```ts
  createNewProject: () => Promise<{ projectId: string | null; error?: string }>;
  openSampleProject: (sampleId: string) => Promise<{ projectId: string | null; error?: string }>;
  ```
  > 返回 `{ projectId, error }` 而非纯 string|null，是为了让 OnboardingPage 能展示错误文案（error 为 i18n key 后缀）。
- 抽内部 helper（减少重复）：`async function registerProjectIntoStore(set, get, projectId, path)` 封装「build baseUrl / derive name / 构造 ProjectState / set Map / setActiveProjectId / addOpenProject / setLastActiveProject」——`openProject`/`createNewProject`/`openSampleProject` 三处复用。可作 store 文件内私有函数，或 keep inline（若抽取出错风险更高，亦可 inline，但接受三份相似代码）。**推荐抽 helper**。
- `createNewProject()`：
  1. `const result = await window.electronAPI.createNewProject()`
  2. `if (!result) return { projectId: null }`（取消）
  3. `if ("error" in result) return { projectId: null, error: result.error }`
  4. 成功：调 `registerProjectIntoStore(result.projectId, result.path)` → `return { projectId: result.projectId }`
- `openSampleProject(sampleId)` 同构，调 `openSampleProject({ sampleId })`。

**测试**（`packages/app/src/stores/__tests__/`，若无基建则跳过单测靠 T7 E2E）：mock `window.electronAPI`，断言成功分支写 Map + setActive + 调 addOpenProject/setLastActiveProject；error 分支返回 `{ projectId:null, error }` 且不写 Map；取消分支返回 `{ projectId:null }`。

**验证**：`npm test --workspace=packages/app`

**依赖**：T2（`window.electronAPI.createNewProject`/`openSampleProject` 类型）

---

## T5 — i18n：onboarding.* keys

**文件**：`packages/i18n/src/locales/zh-CN.ts`、`zh-TW.ts`、`en.ts`

**做什么**：
- `zh-CN.ts`（基准，**每条带场景注释**，遵循 AGENTS.md i18n 规范）新增 `onboarding` 命名空间，key 清单见 design「i18n」表：title / subtitle / action.openExisting / action.createNew / action.openSample（`{name}` 参数插值）/ desc.openExisting / desc.createNew / desc.openSample / dialog.newProjectLocation / dialog.sampleLocation / error.dirExistsNotEmpty / error.createFailed / error.copyFailed / error.sampleNotFound。
- 同步翻译 `zh-TW.ts`（繁体）+ `en.ts`（英文）。
- 删除已无用的 `empty-state.openProject`（`zh-CN.ts:401`）——T6 删除 EmptyState 后无消费方。三语言文件同步删。**先 grep 确认无其它消费**（`empty-state.openProject`）。

**验证**：`npm run check:i18n`（确认三语言 key 对齐）

**依赖**：无

---

## T6 — app/renderer：OnboardingPage 组件 + 路由接线

**文件**：
- `packages/app/src/features/onboarding/OnboardingPage.tsx`（新建，feature root）
- `packages/app/src/pages/OnboardingPage.tsx`（新建，route adapter，re-export 或薄包一层，与 `WelcomePagePage` 风格一致）
- `packages/app/src/router.tsx`（改 index 路由）
- `packages/app/src/components/EmptyState.tsx`（**删除**）

**做什么**：

**features/onboarding/OnboardingPage.tsx**（自治——遵循 AGENTS.md「feature root 组件自治」，自己读 store/action + 自导航，**不经 App.tsx props**）：
- `useAppStore` 取 `openProject`/`createNewProject`/`openSampleProject`
- `useNavigate`（路由页组件有 router context）
- `useI18n` 取 `t`
- `useEffect` 调 `window.electronAPI.getSampleManifest()` 一次，存 `useState<SampleManifestEntry[]>`
- UI：居中布局，三张操作卡片：
  - 卡片 1「从已有项目打开」：点击 → `const id = await openProject(); if (id) navigate(\`/project/${id}\`)`
  - 卡片 2「创建新项目」：点击 → `const { projectId, error } = await createNewProject(); if (projectId) navigate(...); else if (error) toast.error(t(\`onboarding.error.${error}\`))`
  - 卡片 3「打开示例项目」：从 manifest `.map` 渲染（本期仅 harry-potter，但用 map 兼容多示例）；点击 → `const { projectId, error } = await openSampleProject(sample.id); if (projectId) navigate(...); else if (error) toast.error(...)`
- 错误展示：用 `sonner` toast（项目已有 `<Toaster/>`，见 `App.tsx:114`）——`toast.error(t(\`onboarding.error.${error}\`))`；错误码即 i18n key 后缀（T2 IPC 返回的 error 字符串）
- 样式：shadcn semantic token（`bg-card`/`bg-background`/`text-foreground`/`text-muted-foreground`/`hover:bg-accent` 等），逻辑属性（`ps-*`/`pe-*`/`text-start`），无硬编码颜色、无 `dark:` 修饰符。卡片 `rounded-md border border-border`，点击区用 `<button>`。组件控制在 ~150 行软阈值内。

**pages/OnboardingPage.tsx**：薄 adapter（`export { OnboardingPage } from "../features/onboarding/OnboardingPage"` 或直接 re-export）。

**router.tsx**：import 换 `EmptyState` → `OnboardingPage`（from `./pages/OnboardingPage`）；index 路由 `element: <OnboardingPage />`。

**删除** `components/EmptyState.tsx`（grep 确认仅 router 引用后删）。

**测试**（`packages/app/src/features/onboarding/__tests__/`）：渲染三卡片 + 点击触发对应 action mock；manifest 加载后渲染示例卡片；error 分支调 toast。

**验证**：`npm run lint --workspace=packages/app` + `npm test --workspace=packages/app`

**依赖**：T4（store actions）、T5（i18n keys）

---

## T7 — 文档同步 + 最终验证

**做什么**：
- 更新 `docs/dev/backlog.md:28`（`项目创建向导` 条目）：本 feature 完成了「引导页 + 区分新建/打开入口」，未做「名称/默认模型向导」。处理：保持 `[ ]`，在条目后补注 `（引导页+新建/打开入口已完成 @2026-06-28，名称/模型向导待续）`。
- 检查 `docs/official/` 是否需同步：
  - `project-structure.md`：新增 `features/onboarding/`、`presets/sample-projects/`、`electron/sample-projects.ts`、`pages/OnboardingPage.tsx`；删除 `components/EmptyState.tsx`——**需更新**
  - 其它 official doc（`architecture.md`/`data-conventions.md`）是否提及空状态/示例——grep `EmptyState`/`示例`/`sample` 确认
- **手动 dev 验证**（`npm run dev`）：
  1. 无项目时 `/` 显示引导页三卡片
  2. 「创建新项目」弹 save dialog → 命名 → mkdir + 脚手架 + 打开
  3. 「打开示例项目」弹 open directory → 选父目录 → 创建 harry-potter 子目录 + 拷贝 + 打开，可见示例 agent/文档
  4. 目标已存在且非空 → `dirExistsNotEmpty` 错误 toast
  5. 验证 T2 dev 路径解析日志指向 `packages/presets/sample-projects`
- E2E（按 AGENTS.md「E2E 验证选择」：本 feature 影响项目创建/路由/store/IPC，优先跑示例项目路径）：`npm run test:e2e --workspace=packages/app -- e2e/<相关 spec>`（若无现成 onboarding spec，评估是否新增；至少手动验证覆盖）。

**验证**：
```
npm run lint
npm run build
npm test --workspace=packages/app
npm test --workspace=packages/i18n
npm run check:i18n
npm run verify
```

**依赖**：T6

---

## 跨 task 约定

- **不加注释**（AGENTS.md），除非用户要求
- **错误返回结构化**：IPC 返回 `{ error: <code> }`，code 即 i18n key 后缀（如 `"dirExistsNotEmpty"`）；renderer 用 `t(\`onboarding.error.${error}\`)` 映射文案
- **路径安全**：本 feature 不涉及项目内路径解析（main 操作的是用户选定/示例拷贝的**外部**路径，非 `resolveProjectPath` 范畴）；core 经现有 `register` 打开
- **core/server 零改动**：勿在 `packages/core`/`packages/server` 新增任何示例相关逻辑
- **示例内容解耦**：T1 的 harry-potter/ 是占位，用户后续手填丰富内容；T2/T3 机制不假设具体文件内容
- **commit**：完成代码后不自动 commit，等用户明确要求
- **store/组件规范**：遵循 AGENTS.md（OnboardingPage 自治、`useNavigate` 自导航不经 App.tsx props、~150 行软阈值、feature-local 状态不提全局）
