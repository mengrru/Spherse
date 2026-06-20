# 项目设置子菜单（设置入口收纳 + 主题编辑器）

## 背景与动机

当前项目头像右键菜单有一项 `设置欢迎页`（`activity-bar.setWelcomePage`），点击后打开 `WelcomePageSettingsDialog`——一个只负责配置项目欢迎页路径的单表单弹窗。随着项目级可配置项增加（主题是其中之一），单一用途的入口会让菜单不断膨胀。

与此同时，主题系统已有「从 `.spherse/theme.css` 加载自定义 CSS」的能力（`useCustomTheme` hook + `create-ui-theme` skill 文档），但 App 内没有任何 UI 编辑该文件——用户必须手动在文件系统里创建/编辑 `.spherse/theme.css`，门槛较高。

本 feature 将项目头像右键菜单的「设置欢迎页」改为「设置」二级菜单，菜单内含「欢迎页」与「主题」两个独立入口，各自打开独立 Dialog。欢迎页 Dialog 完全不动（逻辑、API、feature 目录均保持），仅从顶级菜单项移入二级菜单；新增「主题」Dialog 与对应 `GET/PUT /settings/theme` 端点。

## 为什么不是合并 Dialog（设计演进记录）

先前考虑过把欢迎页和主题合进**单个带 Tab 的 `ProjectSettingsDialog`**，最终否决，原因：

- **数据流污染**：合并 Dialog 有一个共享保存键。若两个 Tab 用统一加载（一次 GET 全量），用户没浏览过的标签页数据会被点保存时写回，而这些数据可能已过时（尤其 theme 的写入源除用户外还有 LLM `create-ui-theme` skill）。
- 即便拆成"分开读取 + 同一端点增量写入"，也需引入字段级 `Optional`/三态语义，徒增复杂度。
- **二级菜单 + 各自独立 Dialog** 从根本上规避了这个问题：每项设置有独立的 Dialog、独立的保存键、独立的 API，数据流天然隔离。用户只对打开过的那个 Dialog 显式保存，不会触碰其它设置。

## 目标 / 非目标

### 目标
- 项目头像右键菜单项由 `设置欢迎页`（顶级）改为 `设置`（二级菜单容器），内含「欢迎页」「主题」两个子项。
- 「欢迎页」子项行为与原顶级项完全一致（打开同一 `WelcomePageSettingsDialog`，逻辑/API 不变）。
- 新增「主题」独立 Dialog，提供 CSS 文本编辑器直接读写 `.spherse/theme.css`，保存后立即热更新生效。
- 后端**纯增量**：只新增 `GET/PUT /api/projects/:projectId/settings/theme`，不重构现有 welcome-page / ai-access 路由。

### 非目标
- 不改动 App 级 `SettingsModal`（齿轮图标，模型/语言配置）——两者职责不同，App 级设置仍是全局配置。
- 不引入预设主题选择器或可视化取色器（CSS 变量表单）——本次只做 CSS 文本编辑。
- 不改动 `create-ui-theme` skill 的内容（它仍是 CSS 变量参考文档，编辑器不依赖它，但可与之共存）。
- 不支持多文件主题拆分（`@import` 等）——只编辑 `.spherse/theme.css` 单文件。
- 不重构 `welcome-page-settings/` feature 目录与现有 welcome-page API（保持原样）。
- 不合并/参数化 settings 路由（保持 welcome-page / ai-access / providers 现有静态路由）。

## 方案对比

### 方案 1（采用）：二级菜单 + 各自独立 Dialog
右键头像 → `设置`（`ContextMenuSubTrigger`）→ 展开二级菜单 `欢迎页` / `主题` → 各自打开独立 Dialog。

- ✅ 数据流天然隔离：每项设置独立的 Dialog + 独立的保存键 + 独立的 API。
- ✅ 欢迎页部分**零改动**（feature 目录、组件、API、i18n 全部不动），只是从顶级菜单项移入二级子菜单。
- ✅ 后端纯增量，不重构现有路由，最小化回归风险。
- ✅ `ContextMenuSub` 组件已存在（`packages/app/src/components/ui/context-menu.tsx:110-144`），无需新增基础组件。
- ⚠️ 二级菜单比单级菜单多一次点击；但"设置"作为容器语义清晰，且未来新增设置项时扩展自然。

### 方案 2（已否决）：单 Dialog + Tab 切换
合并为带 Tab 的 `ProjectSettingsDialog`。详见上方「为什么不是合并 Dialog」。

- ❌ 共享保存键导致数据流污染风险。
- ❌ 需引入字段级 Optional/三态语义或参数化路由，复杂度高。

### 方案 3：单 Dialog 内多 section 堆叠
在同一 Dialog 里上下堆叠欢迎页和主题两个 section。

- ❌ 同方案 2 的保存语义问题，且编辑器空间被压缩。

**选择方案 1**：数据隔离最干净、改动最小、可扩展。

## 设计

### 1. 菜单入口（二级菜单）

`packages/app/src/features/activity-bar/index.tsx`：
- 顶级菜单项文案改为 `设置`，作为 `ContextMenuSubTrigger`（hover/click 展开）。
- 二级菜单含两项：
  - `欢迎页`（`ContextMenuItem`）→ 触发原欢迎页 Dialog 逻辑（`settingsProjectId` 状态保持不变，仅菜单层级变化）。
  - `主题`（`ContextMenuItem`）→ 触发新主题 Dialog（新增 `themeSettingsProjectId` 状态，与 `settingsProjectId` 并列，互不干扰）。
- 「在 Finder 中显示」「关闭项目」保持为顶级项，与 `设置` 子菜单并列。
- 用到的组件：`ContextMenuSub` / `ContextMenuSubTrigger` / `ContextMenuSubContent` / `ContextMenuItem`（均已在 `components/ui/context-menu.tsx` 导出）。
- 仍支持右键非当前项目头像时直接配置该项目（现有行为，`settingsProjectId` / `themeSettingsProjectId` 各自记录目标 projectId）。

菜单结构示意：
```
[头像右键]
├── 设置 ▶
│   ├── 欢迎页
│   └── 主题
├── 在 Finder 中显示
└── 关闭项目
```

### 2. 前端组件结构

```
features/activity-bar/index.tsx          # 改：菜单结构 + 两个 settings dialog 挂载点
features/welcome-page-settings/          # 不动（保持原样）
features/theme-settings/                 # 新增
└── index.tsx                            # ThemeSettingsDialog
```

#### `ThemeSettingsDialog`（`features/theme-settings/index.tsx`，新增）
- Props：`{ client, open, onOpenChange }`（与 `WelcomePageSettingsDialog` 同构）。
- `useEffect` 打开时 `client.getThemeSettings()` → 初始内容；文件不存在时后端返回 `content: ""`。
- 状态：`content`（当前编辑值）、`savedContent`（已保存快照，用于 dirty 判断与禁用保存按钮）、`loading`、`saving`。
- UI：
  - 描述文案（简述：覆盖 `.spherse/theme.css` 中的 CSS 变量来自定义界面外观；完整变量清单见 create-ui-theme skill）。
  - `<Textarea>`（monospace、`min-h-[240px]`、`font-mono`）作为编辑器。
  - Footer：取消/保存按钮；保存按钮在 `content === savedContent || saving` 时禁用。
- `handleSave`：调用 `client.updateThemeSettings(content)`，更新 `savedContent`，dispatch `THEME_SETTINGS_CHANGED_EVENT`，toast 成功/失败。保存后不自动关闭弹窗（便于继续编辑/预览），仅更新 dirty 状态。
- 保存并触发热更新：`useCustomTheme` 监听 `THEME_SETTINGS_CHANGED_EVENT` 重新拉取样式表。

#### `WelcomePageSettingsDialog`
- **完全不动**。仍由 `features/welcome-page-settings/index.tsx` 导出，被 `ActivityBar` 引用。仅触发方式从顶级菜单项变为二级菜单项。

### 3. 后端：新增 theme 端点（纯增量，不重构现有路由）

在 `packages/server/src/routes/settings.ts` **新增**两条路由，**不删除/不参数化**任何现有路由：

- `GET /api/projects/:projectId/settings/theme` → `{ ok: true, content: string }`。
  - 读 `.spherse/theme.css`；**文件不存在时返回 `content: ""`，不返回 404**（避免编辑器初始化退化分支）。
- `PUT /api/projects/:projectId/settings/theme`，body `{ content: string }`：
  - 校验 `content` 为 string。
  - 确保 `.spherse/` 目录存在（`fs.mkdir(dir, { recursive: true })`）。
  - 在 `projectManager.getFileWriteMutex().run(themeAbsPath, ...)` 下写文件（与 content API 写入一致，避免并发覆盖；theme.css 的另一写入源是 LLM `create-ui-theme` skill）。
  - **返回 `{ ok: true }`，不返回 content**（见下）。

#### 为什么 PUT 不返回 content
- `updateWelcomePageSettings(path)` 返回 `{ path }` 是因为 core 会**转换**输入（`normalizeWelcomePagePath` 校验扩展名、归一化路径），返回转换后的值有意义。
- `PUT /settings/theme` 只是 `fs.writeFile(content)` 原样落盘，**无任何转换**，响应里的 `content` 必然等于请求 body 里的 `content`——客户端已持有该值，返回它纯属冗余。`{ ok: true }` 足够确认写入成功。

#### 为什么不用 content API 读写 theme.css
content API `GET /content/.spherse/theme.css` 在文件缺失时 `throw notFound`（404），编辑器需处理 404→空串退化；新增 settings 端点统一返回空串，语义更直接。写也借 `FileWriteMutex` 保证并发安全。

#### contract schema（`packages/server/src/contracts/settings.ts`，新增）
```ts
themeSettingsRequest: Type.Object({ content: Type.String() }),
themeSettingsOkResponse: Type.Object({ ok: Type.Boolean() }),
```
- `themeSettingsRequest` 用于 PUT body 校验。
- GET 响应无需 schema（或定义 `themeSettingsResponse: Type.Object({ ok, content })` 仅用于 GET；PUT 用 `okResponse`）。考虑到现有 `schemas.okResponse` 已存在，PUT 直接复用。
- 新增 `Static` 类型导出 `ThemeSettingsRequest` / `ThemeSettingsResponse`（后者含 content，仅 GET 用）。

现有 `welcomePageSettingsRequest` / `welcomePageSettingsResponse` schema **保留不变**（端点不动）。

### 4. 热更新机制

`packages/app/src/lib/events.ts`：
```ts
export const WELCOME_PAGE_SETTINGS_CHANGED_EVENT = "spherse:welcome-page-settings-changed";
export const THEME_SETTINGS_CHANGED_EVENT = "spherse:theme-settings-changed";
```

`packages/app/src/hooks/useCustomTheme.ts`：
- 在现有 effect（根据 `projectRoot/baseUrl/projectId` 挂载 `<link>`）基础上，新增 `window.addEventListener(THEME_SETTINGS_CHANGED_EVENT, handler)`。
- `handler`：移除旧 link，重新创建 link（带新 `?t=` 时间戳），保持现有 onerror 清理逻辑。
- cleanup：`removeEventListener`。依赖数组保持 `[projectRoot, baseUrl, projectId]`，handler 用内联函数或 ref，避免每次渲染重绑。

### 5. API client

`packages/app/src/lib/api.ts`：
- **保留** `getWelcomePageSettings()` / `updateWelcomePageSettings(path)` —— 完全不动。
- **新增** `getThemeSettings(): Promise<ThemeSettingsResponse>` → `GET ${apiBase}/settings/theme`，`parseJsonResponse`。
- **新增** `updateThemeSettings(content: string): Promise<{ ok: true }>` → `PUT ${apiBase}/settings/theme`，`parseJsonResponse`。

### 6. i18n

`packages/i18n/src/locales/`（zh-CN 为基准，zh-TW / en 同步翻译）：

**改动**：
- `activity-bar.setWelcomePage`（`设置欢迎页`）→ `activity-bar.settings`（`设置`，二级菜单容器）。

**新增**：
- `activity-bar.settings.welcomePage` — `欢迎页`（二级菜单项）
- `activity-bar.settings.theme` — `主题`（二级菜单项）
- `theme-settings.title` — `设置主题`（主题 Dialog 标题）
- `theme-settings.description` — 主题 Dialog 顶部说明（覆盖 `.spherse/theme.css` CSS 变量自定义界面外观；完整变量见 create-ui-theme skill）
- `theme-settings.loadFailed` — `读取主题设置失败：{message}`
- `theme-settings.saveFailed` — `保存失败：{message}`
- `theme-settings.saved` — `主题已保存`

**保留**：欢迎页表单文案复用现有 `welcome-page-settings.*` key —— welcome-page Dialog 完全不动，这些 key 原样保留。

每条新增文案在 zh-CN 中必须带注释，说明出现位置/上下文，供其它语言翻译参考。

### 7. 文档与 backlog

- `docs/official/project-structure.md`：在 `welcome-page-settings/` 条目旁新增 `theme-settings/` 条目。
- `docs/official/architecture.md`：在「项目 settings API」段落补充 `/api/projects/:projectId/settings/theme` 读写项目级主题 CSS（`{ ok }` 响应）；在 feature 列表中新增 `theme-settings`。
- `docs/dev/backlog.md`：`用户自定义主题`（已 `[x]`，指从文件加载）维持；在「功能增强」区新增一条 `[x] 项目设置子菜单 + 主题编辑器`，指向本 design。

### 8. create-ui-theme skill 关系

`create-ui-theme` skill 文档（`packages/presets/skills/create-ui-theme/SKILL.md`）列出所有可覆盖 CSS 变量。本次新增的编辑器是手动编辑入口，不改变变量集；skill 内容**无需修改**。主题 Dialog 的描述文案中引用该 skill，引导需要变量清单的用户。

## 测试

### Core
- 本次无 core 代码改动（`.spherse/theme.css` 的读写由 server route 直接用 `fs` + `projectManager.getFileWriteMutex` 完成，不新增 `projectManager` 方法）。现有 `project-config` 测试不受影响。

### Server
- 在 `packages/server` 现有 settings/content API contract 测试套件中新增：
  - `GET /settings/theme` 文件不存在 → `{ ok: true, content: "" }`。
  - `PUT /settings/theme` 写入后，`GET` 返回写入内容；`.spherse/` 目录被自动创建。
  - `PUT /settings/theme` 响应为 `{ ok: true }`，不含 content。
  - 并发写：验证 theme 写入走 `FileWriteMutex`（可参考现有 content 写入测试）。
- 现有 `GET/PUT /settings/welcome-page` contract 测试保持不变（端点未动，无回归风险）。

### App
- 新增（若 React 组件测试工具链未就绪则降级为手动/E2E 验证，并在 backlog「React DOM 组件测试工具链」处记录依赖）：
  - 二级菜单展开渲染两个子项。
  - 主题 Dialog 保存触发 `THEME_SETTINGS_CHANGED_EVENT`。
- E2E（可选，按影响面判断）：若现有 E2E 覆盖了项目右键菜单/欢迎页设置流程，更新选择器以匹配新的二级菜单结构（原「设置欢迎页」顶级项变为「设置 → 欢迎页」）；本次变更影响右键菜单结构，优先跑相关 spec。

## 风险

- **右键菜单结构变更破坏 E2E**：若有 E2E 按 `设置欢迎页` 文案定位顶级菜单项，需改为先点「设置」展开再点「欢迎页」。已识别为 E2E 选择器风险，合并前跑相关 spec。
- **主题编辑器误写坏 CSS**：本次不做语法校验（用户自行承担），保存后浏览器原生 CSS 容错即可；`<link onerror>` 仅在 404/network 错误时触发，不处理 CSS 解析失败。可在后续 backlog 增加 lint/预览。
- **大文件性能**：theme.css 通常 < 1KB，`<Textarea>` 足够；不引入 Monaco/CodeMirror，避免增加包体与复杂度。若后续需要可演进。
- **i18n key 重命名兼容**：`activity-bar.setWelcomePage` 直接改为 `activity-bar.settings`（不保留旧 key），因为 i18n 是构建期资源，无运行时回退需求。

## 涉及文件清单

| 文件 | 改动 |
|------|------|
| `packages/app/src/features/activity-bar/index.tsx` | 菜单结构改为二级菜单（设置 ▶ 欢迎页/主题）；新增 `themeSettingsProjectId` 状态与 `ThemeSettingsDialog` 挂载 |
| `packages/app/src/features/welcome-page-settings/` | **不动** |
| `packages/app/src/features/theme-settings/index.tsx` | **新增** `ThemeSettingsDialog` |
| `packages/app/src/lib/api.ts` | 新增 `getThemeSettings` / `updateThemeSettings` |
| `packages/app/src/lib/events.ts` | 新增 `THEME_SETTINGS_CHANGED_EVENT` |
| `packages/app/src/hooks/useCustomTheme.ts` | 监听 `THEME_SETTINGS_CHANGED_EVENT` 热更新 |
| `packages/server/src/routes/settings.ts` | 新增 `GET/PUT /settings/theme`（不删/不改现有路由） |
| `packages/server/src/contracts/settings.ts` | 新增 `themeSettingsRequest` schema + 类型；`welcomePageSettings*` 保留不变 |
| `packages/server/src/__tests__/contracts/api-contracts.test.ts` | 新增 theme contract 测试（welcome-page 测试不动） |
| `packages/i18n/src/locales/zh-CN.ts` / `zh-TW.ts` / `en.ts` | 改菜单文案 + 新增 theme-settings.* 文案 |
| `docs/official/project-structure.md` | 新增 theme-settings 目录条目 |
| `docs/official/architecture.md` | settings API 与 feature 列表新增 theme |
| `docs/dev/backlog.md` | 新增完成条目 |
