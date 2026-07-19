# PR1 实施计划：三层分离 + HostBridge 抽象

> **对应 design：** `docs/dev/features/2026-07-20-mobile-app/design.md` Section 1
>
> **目标：** 把 `packages/app` 拆成三层（共享 `app` + `desktop` shell + `web` shell 骨架），引入 `HostBridge` 抽象并完成 `window.electronAPI` 全量迁移；桌面端功能与 E2E 行为完全不变。
>
> **粒度说明：** 按用户要求，本 plan 只做任务级拆分，每项描述目标、关键改动文件和验证方式，不展开 step-by-step。

---

## Phase A：骨架与目录迁移

### Task A1：创建 `packages/web` 骨架

**目标**：建立 web shell 的空骨架，仅能启动一个空白页。

**关键文件**：
- 创建 `packages/web/package.json`（name `@spherse/web`，依赖 `@spherse/app`、react/react-dom、vite、`@vitejs/plugin-react`、tailwind）
- 创建 `packages/web/vite.config.ts`（react + tailwind 插件，alias `@` 指向 `src`，类似 `packages/app/electron.vite.config.ts` 的 renderer 部分）
- 创建 `packages/web/index.html`、`packages/web/src/main.tsx`（本任务内仅渲染空白 root，HostBridge 在 Task B4 注入）
- 创建 `packages/web/tsconfig.json`（参考 `packages/app/tsconfig.json`）
- 创建 `packages/web/src/styles.css`（import `@spherse/app/src/styles.css` 或复制相同 tailwind 入口）
- `packages/web/scripts`：`dev`、`build`、`lint`、`lint:fix`

**验证**：`npm run dev --workspace=packages/web` 能在浏览器打开空白页；`npm run lint --workspace=packages/web` 通过。

---

### Task A2：创建 `packages/desktop` 骨架（不挪文件）

**目标**：建立 desktop package 的最小可工作骨架，**暂不挪动**任何文件，仅占位让 workspace 识别。

**关键文件**：
- 创建 `packages/desktop/package.json`（name `@spherse/desktop`，依赖 `@spherse/app`、`@spherse/core`、`@spherse/i18n`、`@spherse/presets`、`@spherse/server`，以及 electron 全家桶 devDeps——参考现 `packages/app/package.json`）
- 创建 `packages/desktop/tsconfig.json`（参考 `packages/app/tsconfig.json` + `tsconfig.node.json` 合并）
- 创建空 `packages/desktop/src/.gitkeep`、`packages/desktop/electron/.gitkeep`

**验证**：`npm install` 不报错；workspace 列表包含 `@spherse/desktop`、`@spherse/web`。

---

### Task A3：把 `electron/` 整体从 `packages/app` 迁到 `packages/desktop`

**目标**：Electron shell 代码物理迁移，IPC 通道、协议不变。

**迁移内容**（用 `git mv`）：
- `packages/app/electron/main.ts` → `packages/desktop/electron/main.ts`
- 同上对：`bootstrap.ts`、`preload.ts`、`window.ts`、`server.ts`、`settings.ts`、`settings.test.ts`、`updater.ts`、`updater.test.ts`、`sample-projects.ts`、`ipc/`（整个目录，含 `context-menu.test.ts`）
- `packages/app/shared/electron-api.ts` → `packages/desktop/shared/electron-api.ts`
- `packages/app/electron-builder.yml` → `packages/desktop/electron-builder.yml`
- `packages/app/electron.vite.config.ts` → `packages/desktop/electron.vite.config.ts`（更新入口路径，指向新位置；alias `@` 改为 `../app/src`，`@spherse/i18n/react` 指向 `../i18n/dist/react.js` 等）
- `packages/app/playwright.config.ts` → `packages/desktop/playwright.config.ts`
- `packages/app/e2e/` → `packages/desktop/e2e/`（整个目录）
- `packages/app/vitest.config.ts`（如纯桌面相关则迁移；含共享测试则保留并按需拆分——`packages/app/src/App.structure.test.ts`、`stores/*.test.ts` 属共享，留下）

**package.json 迁移**：
- `packages/app/package.json` 移除 electron 全家桶 devDeps、electron-builder scripts、`main: dist/main/index.js`、`productName`
- 这些迁移到 `packages/desktop/package.json`：scripts `dev`/`build`/`preview`/`pack`/`dist`/`dist:mac`/`dist:win`/`test:e2e`/`pretest:e2e`
- `packages/app/package.json` 保留：scripts `build`（renderer 产物，待 Task B5 调整）、`test`、`lint`、`lint:fix`、`pretest`
- electron 运行时依赖（`electron-store`、`electron-updater`）迁到 desktop

**root `package.json` scripts 调整**：
- `"dev": "npm run dev --workspace=packages/app"` → `"npm run dev --workspace=packages/desktop"`
- `"dist"`、`"dist:mac"`、`"dist:win"`、`"verify:e2e"` 同样改为指向 desktop
- `"build"`：把 `npm run build -w @spherse/app` 改为 `npm run build -w @spherse/desktop`（renderer 由 desktop 全权打包）；web 的 build 在后续 PR 加入
- `"verify"` 中的 `npm test --workspace=packages/app` 保留（共享层测试）；新增 `npm test --workspace=packages/desktop`（IPC 测试）
- `"predev"` 中的 native rebuild 不变

**验证**：
- `npm install` 通过
- `npm run dev --workspace=packages/desktop` 能启动 Electron 应用，行为与改造前完全一致
- `npm run verify:e2e` 通过（先确认 E2E helper 路径正确）

---

## Phase B：HostBridge 接口与实现

### Task B1：定义 `HostBridge` 接口与 `HostCapabilities`

**目标**：在共享层定义抽象接口，所有 shell 实现它。

**关键文件**：
- 创建 `packages/app/src/lib/host-bridge.ts`
  - `HostBridge` 接口：`kind`、`getServerBaseUrl()`、`capabilities: HostCapabilities`、`getSettings()`、`saveSettings()`、`openExternal()`、`saveBlob?()`
  - optional sub-API：`project?: ProjectHostApi`、`updater?: UpdaterHostApi`、`devTools?: DevToolsHostApi`
  - 三个 sub-API 接口（按 design §1.3 的方法映射）
  - `HostCapabilities`（design §1.3 列表）
  - `HostSettings`（与 `IpcAppSettings` 等价的 minimal 形态，可直接 re-export `IpcAppSettings` 类型）
- 复用现有 `packages/desktop/shared/electron-api.ts` 的类型定义（不重复，import 即可）

**验证**：`npm run lint --workspace=packages/app` 通过；类型检查无错（`tsc --noEmit`）。

---

### Task B2：创建 `HostBridgeContext`

**目标**：共享层提供 Provider + hook，让 feature 不再直读 `window.electronAPI`。

**关键文件**：
- 创建 `packages/app/src/context/host-bridge-context.tsx`
  - `HostBridgeContext = createContext<HostBridge | null>(null)`
  - `HostBridgeProvider`、`useHostBridge()`、`useHostBridgeOrNull()`
- 参照现有 `packages/app/src/context/project-context.tsx` 的形态

**验证**：lint 通过；新的 hook 被 export 出去后 `packages/app/src/index.ts`（如有 barrel）按导出规范处理。

---

### Task B3：实现 `ElectronHostBridge`

**目标**：desktop 端实现 `HostBridge`，内部转发到 `window.electronAPI`。

**关键文件**：
- 创建 `packages/desktop/src/host-bridge-electron.ts`
  - `createElectronHostBridge(): HostBridge`
  - `kind: "electron"`
  - `getServerBaseUrl()`：调 `window.electronAPI.getServerPort()`，返回 `http://localhost:${port}`
  - `capabilities`：全开（`projectManagement: true`、`filePicker: true`、`appUpdate: true`、`devTools: true`、`settings.editable: true, scope: "local-only"`、`content.editable: true`）
  - `getSettings/saveSettings`：转发到 electronAPI
  - `openExternal`：转发到 `window.electronAPI.openExternal`
  - `saveBlob`：调 `showSaveDialog` 得到路径后，由调用方写入（或返回 `{ filePath }` 让调用方处理——按现有 `HtmlCard.tsx:93`、`ImageCard.tsx:22` 的实际用法决定签名；保持行为不变）
  - `project` / `updater` / `devTools`：直接把对应子集方法绑过去

**验证**：lint 通过；类型检查通过。

---

### Task B4：实现 `WebHostBridge` stub

**目标**：web shell 提供最小可用的 stub 实现，让共享层 mount 成功。

**关键文件**：
- 创建 `packages/web/src/host-bridge-web.ts`
  - `createWebHostBridge(): HostBridge`
  - `kind: "web"`
  - `getServerBaseUrl()`：从 `localStorage` 读 `spherse:connection` 的 `baseUrl`（本 PR 不会真正写入，stub 返回空串或抛"未连接"）
  - `capabilities`：全关，`content.editable: false`、`settings.scope: "local-only"`
  - `getSettings/saveSettings`：localStorage 读写（键 `spherse:settings`）
  - `openExternal`：`window.open(url, "_blank", "noopener")`
  - `saveBlob`：创建 `<a download>` 触发下载
  - `project`/`updater`/`devTools`：`undefined`

**验证**：`npm run dev --workspace=packages/web` 启动后能渲染共享 root（注入 stub），无运行时错误；白屏展示一个 "未连接" 占位即可。

---

### Task B5：把 `packages/app/src/main.tsx` 改造为共享 root 工厂

**目标**：共享 root 不再直接 `createRoot`，改为导出工厂，由各 shell 注入 bridge。

**关键文件**：
- `packages/app/src/main.tsx` 改为：
  - 移除 `createRoot(...).render(...)`
  - 移除副作用 `import "./lib/electron-api"`
  - 导出 `createAppRoot(bridge: HostBridge)`：内部 `createRoot(...).render(<HostBridgeProvider bridge={bridge}><RouterProvider router={router} /></HostBridgeProvider>)`
- 创建 `packages/desktop/src/main.tsx`：
  - `import "../app/src/lib/electron-api"`（副作用，让 `window.electronAPI` 类型生效）——实际路径按 alias
  - 调用 `createAppRoot(createElectronHostBridge())`
  - 作为 `electron.vite.config.ts` 的 renderer 入口
- 更新 `packages/desktop/electron.vite.config.ts` 的 renderer 入口指向 `packages/desktop/src/index.html` → `packages/desktop/src/main.tsx`
- 创建 `packages/desktop/src/index.html`（复制自现 `packages/app/index.html`，调整 script src）
- 更新 `packages/web/src/main.tsx` 调用 `createAppRoot(createWebHostBridge())`
- `packages/app/index.html` 保留作为共享层 lint/build 引用（如果不再需要可删除）

**验证**：桌面应用 `npm run dev --workspace=packages/desktop` 正常启动；web `npm run dev --workspace=packages/web` 正常启动；共享层不再直读 `window.electronAPI`（grep `packages/app/src` 应仅剩 `lib/electron-api.ts` 的 global 类型声明文件）。

---

## Phase C：`window.electronAPI` 全量迁移

> 每个任务完成后跑 `npm run lint`、相关单测，最后跑桌面 E2E 验证回归。
>
> 现有 58 处调用的迁移按 design §1.5 的 P0→P3 顺序推进。迁移完成后 `packages/app/src/lib/electron-api.ts` 仅保留 global 类型声明（供 desktop 入口副作用 import），共享层 feature 不再直接读 `window.electronAPI`。

### Task C1（P0）：server baseUrl 与设置

**目标**：基础连通性与设置走 HostBridge。

**改动**：
- `packages/app/src/stores/app-store.ts`：`window.electronAPI.getServerPort()` → 通过 `useHostBridge().getServerBaseUrl()`；`addOpenProject`/`setLastActiveProject` 等改走 `hostBridge.project?.xxx`
- `packages/app/src/stores/bus-store.ts:104`：同上替换 baseUrl 来源
- `packages/app/src/stores/settings-store.ts`：`loadLocale` 接收 `HostBridge` 而非 `ElectronAPI`；保存设置走 `hostBridge.saveSettings()`
- `packages/app/src/App.tsx:59`：`loadSettings(window.electronAPI)` → `loadSettings(hostBridge)`（hostBridge 通过 `useHostBridge()` 拿）
- 相应更新单测：`app-store.test.ts`、`bus-store.test.ts`、`settings-store.test.ts`（mock HostBridge 替代 mock electronAPI）

**验证**：桌面启动行为不变；web 启动不报错；单测通过。

---

### Task C2（P1-a）：Onboarding / Sample / Skill 文件选择

**目标**：项目管理相关入口走 `hostBridge.project`，capability 不足时整段不渲染。

**改动**：
- `packages/app/src/features/onboarding/OnboardingPage.tsx`：用 `useHostBridge()` 拿 `project`，调 `getSampleManifest` / `openSampleProject`；更新 `OnboardingPage.structure.test.ts`
- `packages/app/src/features/skill-panel/index.tsx:42`：`selectSkillZip` → `hostBridge.project?.selectSkillZip()`；按钮通过 `capabilities.filePicker` 守卫

**验证**：桌面 onboarding 与 skill 安装行为不变；web 端这两个入口因 capability 关闭而不渲染。

---

### Task C3（P1-b）：Debug tools 与 Updater UI

**目标**：桌面专属 feature 通过 capability 守卫挂载，内部走 `hostBridge.devTools` / `hostBridge.updater`。

**改动**：
- `packages/app/src/features/debug-tools/*`：把 `window.electronAPI.toggleDevTools` / `getElectronStoreData` / `reloadRenderer` / `resetAppData` / `isDev` 改走 `useHostBridge().devTools?.xxx`
- `packages/app/src/features/settings/use-update-checker.ts`：updater 调用全部改走 `hostBridge.updater?.xxx`
- `packages/app/src/features/settings/UpdateChecker.tsx`：`getAppVersion` / `openExternal` 改走 hostBridge
- 在 `App.tsx` 或桌面 layout 处加 capability 守卫：`hostBridge.capabilities.devTools` 控制 Debug Tools activity bar 入口；`hostBridge.capabilities.appUpdate` 控制 UpdateChecker 挂载

**验证**：桌面 dev/prod 模式下 Debug Tools 入口显隐行为不变；UpdateChecker 行为不变；web 端不挂载这两个 feature。

---

### Task C4（P2）：通用能力替代（saveBlob / openExternal）

**目标**：跨端通用功能用 Web API 替代 Electron 专属 API。

**改动**：
- `packages/app/src/features/chat/HtmlCard.tsx:93`：`showSaveDialog` → `hostBridge.saveBlob(filename, blob)` 或 `hostBridge.saveBlob` 不存在时降级浏览器下载；保持文件名生成逻辑
- `packages/app/src/features/chat/ImageCard.tsx:22`：同上
- `packages/app/src/features/content-browser/ContentView.tsx:63`：`openExternal(href)` → `hostBridge.openExternal(href)`
- 其他 `openExternal` 直读处（grep 确认）一并迁移

**验证**：桌面 HtmlCard/ImageCard 保存对话框行为不变；ContentView 外链打开行为不变。

---

### Task C5（P3）：项目管理调用收尾

**目标**：扫尾所有剩余 `window.electronAPI` 直读（应已接近 0）。

**改动**：
- `rg "window\.electronAPI" packages/app/src` 拿到剩余清单
- 逐一迁移到对应 hostBridge 子 API
- 确认 `packages/app/src/lib/electron-api.ts`（global 类型声明）是共享层唯一保留 `electronAPI` 字样的文件

**验证**：`rg "window\.electronAPI" packages/app/src` 输出仅 `lib/electron-api.ts`；lint + 单测 + 桌面 E2E 全通过。

---

## Phase D：构建配置与文档同步

### Task D1：root 与各 package 的 lint / build / test 脚本对齐

**目标**：保证 `npm run lint` / `npm run verify` / `npm run verify:e2e` 在新结构下正常工作。

**改动**：
- root `package.json`：按 Task A3 调整 dev/dist/verify/verify:e2e 指向
- `eslint.config.js`（root flat config）：确保覆盖 `packages/desktop/**`、`packages/web/**`；按需为 web 启用 react-hooks / react-refresh
- 各 package 的 `lint` script 都能独立跑

**验证**：`npm run lint` 全仓通过；`npm run verify` 通过；`npm run verify:e2e` 通过。

---

### Task D2：更新 `AGENTS.md` / `docs/official/project-structure.md`

**目标**：保持正式文档与代码同步（AGENTS.md 明确要求）。

**改动**：
- `AGENTS.md`：
  - 「项目目录索引」段加入 `packages/desktop`、`packages/web`
  - 「启动和联调方式」段：dev/dist 命令更新到 desktop workspace
  - 「测试命令」段：补 `npm test --workspace=packages/desktop`、`npm test --workspace=packages/web`（如有测试）
- `docs/official/project-structure.md`：同步新目录结构
- `docs/dev/backlog.md`：把「移动端 App」加为新条目（状态进行中），链接到 design.md

**验证**：人工 review 文档与实际结构一致。

---

### Task D3：PR1 完整回归

**目标**：所有验证命令一次性通过，确认 PR1 可合并。

**执行**：
- `npm install`
- `npm run lint`
- `npm run build`
- `npm run verify`
- `npm run verify:e2e`
- `npm run dev --workspace=packages/desktop`：手动验证桌面应用启动、打开项目、聊天、文件浏览、设置等核心功能
- `npm run dev --workspace=packages/web`：手动验证空白 PWA 启动，无控制台错误

**提交策略**：按 Phase（A → B → C → D）分多次 commit；最终 PR 包含全部 4 个 phase。Commit message 前缀 `feat:` / `refactor:` / `chore:`。

---

## Self-Review 结论

- **Spec 覆盖**：design §1.1（目录结构）→ Task A1/A2/A3 + D2；§1.2（详细目录树）→ 同上；§1.3（HostBridge 接口）→ B1；§1.4（注入方式）→ B2/B5；§1.5（迁移策略 P0-P3）→ C1-C5；§1.6（main.tsx 工厂）→ B5；§1.7（不实现的部分）→ Phase 范围明确排除；§1.8（验证标准）→ D3。
- **占位符扫描**：无 "TBD"，所有任务都给出了具体文件路径与改动方向（按用户要求未展开代码细节）。
- **类型一致性**：`HostBridge` / `HostCapabilities` / `ProjectHostApi` / `UpdaterHostApi` / `DevToolsHostApi` 在 B1 定义，B3/B4 实现引用同一套类型；`createAppRoot(bridge)` 签名在 B5 定义、被 desktop/web 入口一致调用。
- **未覆盖项**：design 中 PR1 范围外的内容（mobile 实际 UI、server auth、tunnel 集成）按规划留到 PR2-PR4，本 plan 不涉及。
