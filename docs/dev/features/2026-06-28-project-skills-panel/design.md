# Project Skills Panel — Design

- Date: 2026-06-28
- Status: Design (awaiting review)
- Related: `2026-05-12-skill-support`（skills 读取基础设施）、`2026-06-20-builtin-skills`（preset skills）

## 1. 背景与目标

目前 `.spherse/skills/{name}/SKILL.md` 形式的项目技能只能被 agent 通过 `load_skill` 工具读取，用户无法在 UI 中查看、创建或安装技能。本 feature 在 project panel 的「Files」section 下方新增「Skills」section，让用户可以：

1. 以 file tree 形式浏览 `.spherse/skills/` 下所有项目技能及其内部文件；
2. 点击技能文件夹内的文件，复用 content browser 打开浏览/编辑；
3. 通过 section 右上角三点菜单「创建技能」「安装技能」；
4. 创建技能：弹 dialog 填写名称 + 描述 + 内容，生成合法 SKILL.md；
5. 安装技能：弹出原生文件选择器选 `.zip` 包，服务端校验后解压安装；
6. 技能的读写均通过 server 直接读写文件系统。

展示范围：**仅项目技能**（`source: "project"`，即 `.spherse/skills/` 下的）。内置/预设技能不在此面板展示（它们没有可编辑的本地文件）。

## 2. 关键决策（已与需求方对齐）

| 决策点 | 选择 | 理由 |
|---|---|---|
| FileTree 复用方式 | **拆分 `file-tree` 为可复用 base component + `user-file-panel` feature**；base 新增可选 `rootPath`（默认 `""`）供 `skill-panel` 等复用 | 把「通用树渲染/模型/controller」与「Files section 专属职责（AI 读黑名单）」分离，符合 feature 边界原则；base 可被任意子目录浏览复用；Files 行为零变化（user-file-panel 传默认 `rootPath`） |
| Server 访问策略 | 把 `skills` 类别加入 `SRV_READ` **与** `SRV_WRITE` | 让通用 `/content` GET/PUT/DELETE + file-tree 浏览 + content browser 读/存都统一走既有路由；范围严格限定 `.spherse/skills/**`，不放开整个 `.spherse` |
| 文件夹级生命周期写（创建/安装） | 新增**专用** skill 管理路由 | 涉及多文件创建（建目录 + 写带 frontmatter 的 SKILL.md）、zip 解压校验，单文件 content 路由无法表达 |
| 创建技能 dialog 字段 | 名称 + 描述 + 内容 | SkillStore 要求 SKILL.md frontmatter 必须有 `name` + `description` 才会被识别；保证生成即有效 |
| 安装 zip 约定 | zip 内含**单个技能文件夹**（含 SKILL.md，frontmatter 合法）；同名则报错阻止 | 行为可预测、安全；不静默覆盖用户已有修改 |
| 删除技能 | 复用 FileTree 右键删除（通用 `DELETE /content`） | `skills` 已加入 SRV_WRITE，无需专用删除路由 |
| 展示范围 | 仅项目技能 | 符合需求原文；内置技能无可编辑本地文件 |

## 3. 架构概览

```
ProjectPanel (aside, 薄组合层)
├─ AgentSessionList            (existing feature)
├─ <UserFilePanel />           (NEW feature, 复用 base FileTree, rootPath="")
│   └─ Files SidebarGroup + AiReadDenylistDialog
└─ <SkillPanel />              (NEW feature, 复用 base FileTree, rootPath=".spherse/skills")
    └─ Skills SidebarGroup
       ├─ SidebarGroupAction: 三点菜单 → [创建技能 / 安装技能]
       └─ <FileTree rootPath=".spherse/skills" .../>   (base component, parameterized)
           ├─ 创建技能 → CreateSkillDialog → POST /skills
           └─ 安装技能 → IPC selectSkillZip → POST /skills/install {zipPath}

components/file-tree/ (base, 可复用) ← 被 user-file-panel 与 skill-panel 共用
```

数据流（复用既有机制）：
- **浏览**：`FileTree` controller `listContent(".spherse/skills")` → `GET /content/.spherse/skills`（SRV_READ 放行）→ 以技能文件夹为顶层节点渲染。
- **打开文件**：点击文件节点 → `onSelectFile(".spherse/skills/x/SKILL.md")` → `navigate(/content?path=...)` → ContentBrowserPage → ContentBrowser `GET/PUT /content/...`（读写均放行）。
- **创建**：三点菜单 → CreateSkillDialog → `POST /skills {name,description,instructions}` → 服务端写 `.spherse/skills/{name}/SKILL.md` → fs-watch 触发树刷新。
- **安装**：三点菜单 → IPC 选 zip → `POST /skills/install {zipPath}` → 服务端校验+解压 → fs-watch 刷新。
- **删除**：技能文件夹右键 → 既有删除确认 → `DELETE /content/.spherse/skills/{name}`。

## 4. 详细设计

### 4.1 前端重构 — file-tree 拆为 base component + user-file-panel feature（核心改动）

当前 `features/file-tree/` 把「通用树渲染/模型/controller」与「Files section 专属职责」混在一起。为让 `skill-panel`（及未来其它子目录浏览）干净复用，先做如下拆分：

**A. 迁出 base component → `packages/app/src/components/file-tree/`（可复用，不含 section 专属逻辑）**

从 `features/file-tree/` 整体迁入 `components/file-tree/`：
- `tree-model.ts`（TreeNode / buildNodes / updateNode / mergeExpandedState / INVALID_NAME_RE）。
- `FileTree`（组件本体）、`FileTreeNode.tsx`、`file-tree-context.tsx`。
- `useFileTreeController.ts`、`useFsWatchRefresh.ts`。
- 通用创建/删除 UI：`FileTreeContextMenu.tsx`、`DeleteConfirmDialog.tsx`、`InlineNameInput.tsx`。

**不迁入** base 的 Files 专属内容：`AiReadDenylistDialog.tsx`（随 user-file-panel 留在 feature 层）。

**B. base `FileTree` 参数化 `rootPath`**

- `FileTreeProps` 新增可选 `rootPath?: string`（默认 `""`）。
- `useFileTreeController` 签名新增 `rootPath` 参数；将原本硬编码的 `""` 基准替换为 `rootPath`：
  - 初始加载：`loadChildren(rootPath)`、`buildNodes(entries, rootPath)`。
  - `refreshRoot`：基准改为 `rootPath`。
  - `submitCreate` 顶层创建判断由 `parentPath === ""` 改为 `parentPath === rootPath`。
  - `FileTree` 顶层 `InlineNameInput`（根级创建）触发条件改为基于 `rootPath`。
- **节点 `path` 保持「相对项目根」的完整路径**（如 `.spherse/skills/my-skill/SKILL.md`）。因此 `selectedFilePath` 匹配、`updateNode`、`mergeExpandedState`、`useFsWatchRefresh` 全部无需改动。
- `buildNodes` 过滤以 `.` 开头的条目——技能文件夹不以 `.` 开头，不受影响；`listContent(".spherse/skills")` 返回的是该目录下的条目（目录本身不被二次过滤）。

**C. 新增 feature `packages/app/src/features/user-file-panel/`（替换原 Files section 内联代码）**

- `UserFilePanel`：承载原 `ProjectPanel` 中 Files `SidebarGroup`——`SidebarGroup` + `SidebarGroupLabel`(files) + `SidebarGroupAction`(AI 读黑名单入口) + `SidebarGroupContent` 渲染 base `<FileTree />`（`rootPath` 默认 `""`，行为完全不变）。
- 从 `features/file-tree/` 迁入 `AiReadDenylistDialog.tsx` 及其状态到该 feature（AI 读黑名单是 Files 专属能力）。
- `selectedFilePath`/`onSelectFile`/`onDeleted` 由该 feature 自治（直接 `useProjectCtx` + `useNavigate` + `useSearchParams`，遵循 feature root 自治原则），不再由 ProjectPanel 透传。

**D. 迁移安全**：base 文件移动后更新所有 import 路径；`FileTree` 等导出从 `components/file-tree`；既有 `ProjectPanel.structure.test.ts` 中侧边栏浮动/隐藏类断言不变（仅数据流来源从内联改为 `<UserFilePanel>`/`<SkillPanel>`）。

### 4.2 前端 — SkillPanel feature（Skills section 与菜单）

文件：新增 `packages/app/src/features/skill-panel/`、`packages/app/src/features/project-panel/index.tsx`。

- 新增 feature `features/skill-panel/`，导出 `SkillPanel`：Skills `SidebarGroup` section，渲染 base `<FileTree rootPath=".spherse/skills" />`。
  - `SidebarGroupLabel`：`t("project-panel.skills")`。
  - `SidebarGroupAction`：`MoreHorizontalIcon` → shadcn `DropdownMenu`，两项「创建技能」「安装技能」。
  - `<FileTree rootPath=".spherse/skills" selectedFilePath={contentPath} onSelectFile={handleSelectFile} onDeleted={handleFileDeleted} />`（`handleSelectFile`/`handleFileDeleted` 在本 feature 内自治，逻辑与 Files 一致：navigate 到 content、删除后回退）。
  - `CreateSkillDialog.tsx`：shadcn `Dialog`，三个字段——名称（同时作为文件夹名与 frontmatter `name`）、描述（frontmatter `description`）、内容（SKILL.md 正文 `instructions`，textarea）。提交调用 `client.createSkill(...)`，成功后关闭弹窗 + toast，失败 toast（不主动刷新树，见下）。
  - 安装流程：点击「安装技能」→ `window.electronAPI.selectSkillZip()` 取绝对路径 → `client.installSkill(zipPath)` → 成功 toast；冲突/非法 → toast 错误信息；取消无操作。
  - 轻量 `useState` 管理 `createOpen`（不提升到全局 store，遵循 store 原则）。
  - **刷新机制**：不使用主动 `refreshKey`。技能树刷新统一走被动链路——server `fs-watcher` 的 `WATCHED_CATEGORIES` 已包含 `skills` 类别，`.spherse/skills/**` 下任何文件变更都会经 bus 推送 `fs-watch` 事件，renderer `useFsWatchRefresh` 订阅后 300ms 防抖触发 `refreshRoot`。这与 Files 面板一致（Files 也只靠 fs-watch + 删除内部 refreshRoot）。
- `ProjectPanel` 退化为薄组合层：按序渲染 `<AgentSessionList />`、`<UserFilePanel />`、`<SkillPanel />`；仅保留 `SidebarProvider` 包裹与 `useSidePanel` 浮动/隐藏布局逻辑，不再透传 section 数据/回调。

### 4.3 后端 — 访问策略调整

文件：`packages/core/src/access/access-policy.ts`。

- `SRV_READ` 与 `SRV_WRITE` 各加入 `"skills"` 类别。
- `categorizePath` 已把 `.spherse/skills/**`（含目录本身，glob `.spherse/skills/**` 经转换匹配 `.spherse/skills` 与其下所有内容）归为 `"skills"`，所以加入该类别后，通用 `/content` 与 `/file-tree` 路由即可读写技能目录，**且仅限 `.spherse/skills/**`**——`.spherse` 其它子路径（project.yaml、agents/、theme.css 等）仍被 `spherseOther`/具体类别挡在 server 读写集外。
- 既有 `useFsWatchRefresh` 会监听项目 FS 变更并刷新树，技能文件增删后会自动反映。

### 4.4 后端 — 专用 skill 生命周期路由

文件：`packages/core/src/store/skill.ts`（SkillStore 写逻辑）、`packages/server/src/routes/skills.ts`（路由委派 PM）、`packages/server/src/contracts/skills.ts`。

#### `POST /api/projects/:projectId/skills` — 创建技能
- body：`{ name: string; description: string; instructions: string }`。
- 服务端校验：
  - `name` 非空、不含 `/ \ :`、不以 `.` 开头（与 `INVALID_NAME_RE` 一致）。
  - `description` 非空。
  - `.spherse/skills/{name}/` 不存在 → 否则 `409`。
- 行为：创建目录，写 `SKILL.md`，内容为 `---\nname: {name}\ndescription: {description}\n---\n\n{instructions}\n`，经 `FileWriteMutex` 串行化。
- 响应：返回新建的 `SkillDefinition`（`source: "project"`）。

#### `POST /api/projects/:projectId/skills/install` — 从 zip 安装
- body：`{ zipPath: string }`（绝对路径，由原生文件选择器返回；服务端本地可信，复用 `images/export` 传绝对路径的既有模式，避免 multipart / 字节穿透 renderer）。
- 行为：
  1. 读取并解析 zip（新增依赖 `adm-zip`，纯 JS、无 native 依赖，利于 Electron 打包；实现阶段最终确认）。
  2. 校验：zip 顶层**有且仅有一个**目录条目，其下必须含 `SKILL.md`，frontmatter 必须有合法 `name` + `description`。
  3. 安全校验：拒绝绝对路径条目、含 `..` 的条目、解压后落在 `.spherse/skills/` 之外的条目（路径穿越防护）。
  4. 冲突检查：目标 `.spherse/skills/{name}/` 已存在 → `409`，不覆盖。
  5. **原子化**：先解压到临时目录（OS tmp 或 `.spherse/.tmp/skill-install-{id}`），全部校验通过后再 `rename`/移动进 `.spherse/skills/`，避免半成品。
- 响应：成功返回安装的 `SkillDefinition`。

#### 删除
- 不新增专用路由：`skills` 已在 SRV_WRITE，技能文件夹右键删除走既有 `DELETE /content/.spherse/skills/{name}`。

### 4.5 后端 — SkillStore 写入 + ProjectManager 委托 / Contracts

- skill 的写逻辑（创建/安装）实现在 **`SkillStore`**（`packages/core/src/store/skill.ts`）——它已拥有 skill 读取（解析 SKILL.md frontmatter + 目录布局），写入放这里让「skill 文件格式」单一所有者，与 `ProjectStore.createAgent`（agent 写逻辑在 store）模式一致。
  - `SkillStore.createSkill(name, description, instructions)`：校验名称（`INVALID_SKILL_NAME_RE` + 无前导 `.` + 非空）、描述非空；目标 `.spherse/skills/{name}/` 不存在否则 `ConflictError`；建目录 + 经 store 自有的 `FileWriteMutex`（以 skill 目录为 key）写 `SKILL.md`（`matter.stringify` 生成 frontmatter + 正文）；返回 `this.get(name)`。
  - `SkillStore.installSkill(zipPath)`：adm-zip 读取；校验顶层单一目录 + `{folder}/SKILL.md` + frontmatter 合法 + `name===folder`；逐条 zip-slip 校验（`isPathInside`）；冲突检查；原子化（`os.tmpdir()` 解压 → 校验 → `moveDirAtomic` 移入，mutex key 同为 skill 目录，`try/finally` 清理 temp）；返回 `this.get(folder)`。
  - `ConflictError` 留在 `@spherse/core` errors（server 错误处理器映射 → 409）。
- `ProjectManager.createSkill/installSkill` 改为**纯委托** `projectStore.skill.createSkill(...)/installSkill(...)`，与既有 `listSkills`/`getSkill` 一致（PM 保持 facade 角色，不再持有 skill 写逻辑）。
- `contracts/skills.ts` 新增 `skillCreateRequest`、`skillInstallRequest` schema 与对应 `Static` 类型（命名遵循 codebase entity-first 约定，如 `agentCreateRequest`）；`contracts/index.ts` 汇总。响应复用既有 `skillDefinition`。

### 4.6 Electron IPC

文件：**新建 `packages/app/electron/ipc/skill.ts`**、`electron/preload.ts`、`@shared/electron-api.ts`。

- 按既有 per-domain IPC 组织（`project.ts` / `settings.ts` / `debug.ts`）新建 `ipc/skill.ts`，导出 `registerSkillIpc(getWindow)`，并在既有聚合点 `electron/ipc/index.ts` 的 `registerAllIpc` 中调用注册。
- 新增 IPC handler `select-skill-zip`：`dialog.showOpenDialog`，`properties:["openFile"]`，`filters:[{name:"Zip",extensions:["zip"]}]`，返回绝对路径或 `null`（canceled）。
- preload 暴露 `selectSkillZip: () => ipcRenderer.invoke("select-skill-zip")`。
- `ElectronAPI` 类型新增该方法。
- 安装时 renderer 拿到绝对路径后 `POST /skills/install {zipPath}`，服务端本地读盘——与 `images/export` 传绝对 `dest` 路径同构，零字节穿透 renderer。

### 4.7 ApiClient

文件：`packages/app/src/lib/api.ts`。

- `createSkill(name, description, instructions)` → `POST /skills`，body JSON，响应 `parseApiResponse(schemas.skillDefinition)`。
- `installSkill(zipPath)` → `POST /skills/install`，body JSON，响应 `parseApiResponse(schemas.skillDefinition)`。

### 4.8 i18n

文件：`packages/i18n/src/locales/zh-CN.ts`（基准，每条配 UI 场景注释）+ `en.ts`、`zh-TW.ts`。

新增 key（示例命名）：
- `project-panel.skills`（Skills section 标题）
- `skill-panel.create`、`skill-panel.install`（菜单项）
- `skill-panel.empty`（无技能时占位文案）
- `skill-panel.createDialog.title/nameLabel/descriptionLabel/contentLabel/submit/cancel`
- `skill-panel.create.success`、`skill-panel.create.failed`、`skill-panel.create.exists`
- `skill-panel.install.success`、`skill-panel.install.failed`、`skill-panel.install.exists`（安装冲突时客户端无法获知技能名，故此条不展示名称）
- 名称校验提示：`skill-panel.nameInvalid`

## 5. 错误处理

- **创建**：名称非法（空/含 `/ \ :`/`.` 前缀）→ dialog 内联校验禁用提交 + 提示；服务端 409 已存在 → toast `create.exists`；写入异常 → toast `create.failed`。
- **安装**：非 zip / 无 SKILL.md / frontmatter 非法 / 路径穿越 / 同名冲突 → 服务端 400 或 409 带可读 message → renderer toast 对应文案；取消选择 → 无操作。原子化保证不残留半成品。
- **浏览/读取**：`.spherse/skills` 不存在或为空 → 树显示 `skill-panel.empty` 空状态文案。
- 所有写操作走 `FileWriteMutex`，避免并发写丢失。

## 6. 测试计划

- **`packages/core`**：
  - 访问策略：`skills` 类别经 `serverAccessPolicy` 可读可写；其它 `.spherse` 子路径仍被拒。
  - `ProjectManager.createSkill`：写出合法 SKILL.md（frontmatter + 正文）；重名 → 抛冲突；非法 name → 拒绝。
  - `ProjectManager.installSkill`：合法 zip 安装成功；同名冲突；缺 SKILL.md / frontmatter 非法 / 路径穿越条目 → 拒绝；原子化（失败不残留）。
- **`packages/server`**（contract test）：`POST /skills` 成功/409；`POST /skills/install` 成功/冲突/ malformed；并验证 `GET/PUT/DELETE /content/.spherse/skills/...` 现已放行。
- **`packages/app`**：更新 `ProjectPanel.structure.test.ts` 断言 ProjectPanel 现渲染 `<UserFilePanel/>` + `<SkillPanel/>`（侧边栏浮动/隐藏类不变）；base `FileTree` 参数化单测（`rootPath` 驱动 list 基准、节点路径仍为完整路径、Files 行为不回归）；CreateSkillDialog 表单提交与校验；user-file-panel / skill-panel 各自的 section 渲染。

## 7. 范围与非目标

- 不展示/编辑内置或预设技能（无可编辑本地文件）。
- 不支持技能重命名/移动（可用删除 + 重建/重装代替）。
- 不支持技能导出/打包为 zip（本期仅安装）。
- 不支持拖拽安装（仅原生文件选择器）。
- 不改 `SkillStore` 的合并/override 语义（项目技能仍按 name 覆盖同名内置技能）。

## 8. 涉及文件清单

前端：
- `packages/app/src/components/file-tree/`（**新建 base**：从 `features/file-tree/` 迁入 tree-model / FileTree / FileTreeNode / context / hooks / 通用 dialog；base `FileTree` 增加 `rootPath`）
- `packages/app/src/features/user-file-panel/`（**新建 feature**：Files SidebarGroup + AiReadDenylistDialog，复用 base `<FileTree rootPath="">`）
- `packages/app/src/features/skill-panel/`（**新建 feature**：Skills SidebarGroup、CreateSkillDialog、安装流程，复用 base `<FileTree rootPath=".spherse/skills">`）
- `packages/app/src/features/file-tree/`（迁移后删除/清空，AiReadDenylistDialog 迁至 user-file-panel）
- `packages/app/src/features/project-panel/index.tsx`（退化为薄组合层：渲染 `<AgentSessionList/> <UserFilePanel/> <SkillPanel/>`）
- `packages/app/src/lib/api.ts`（createSkill / installSkill）
- `packages/app/src/features/project-panel/ProjectPanel.structure.test.ts`（更新）

Electron：
- `packages/app/electron/ipc/skill.ts`（**新建**）、IPC 注册入口、`electron/preload.ts`、共享 `electron-api.ts`

后端：
- `packages/core/src/access/access-policy.ts`（SRV_READ/SRV_WRITE +skills）
- `packages/core/src/project-manager.ts`（createSkill / installSkill）
- `packages/server/src/routes/skills.ts`（POST 创建 / 安装）
- `packages/server/src/contracts/skills.ts`、`contracts/index.ts`

i18n：
- `packages/i18n/src/locales/{zh-CN,en,zh-TW}.ts`

依赖：
- 新增 zip 解压库（建议 `adm-zip`，实现阶段确认）。

## 9. 风险与缓解

- **放宽 `.spherse` 写权限的安全面**：仅放开 `skills` 类别（精确匹配 `.spherse/skills/**`），project.yaml / agents / theme.css 等仍不可经通用 content 路由写；创建/安装的写仍受 server 专用路由校验。
- **zip 穿越攻击（Zip Slip）**：解压前逐条校验目标路径落在 `.spherse/skills/{name}/` 内，拒绝 `..`/绝对路径条目。
- **FileTree 拆分/参数化回归**：base 文件迁移后更新全部 import；`user-file-panel` 传默认 `rootPath=""`，保证 Files 行为零变化；节点 path 始终为「相对项目根」的完整路径，`selectedFilePath`/`mergeExpandedState`/`useFsWatchRefresh` 不受影响；补单测覆盖两棵树（Files / Skills）。
- **半成品安装**：临时目录解压 + 校验通过后再移动，失败回滚清理。
