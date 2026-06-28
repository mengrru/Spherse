# Project Skills Panel — Implementation Plan

- Feature design: `./design.md`
- Mode: subagent-driven（每个 task 独立可验证；标注的 deps 决定可并行度）

## 任务依赖图

```
Layer 0 (全部可并行，无相互依赖):
  T1 access-policy   T2 contracts   T3 ProjectManager(+zip)   T4 Electron IPC
  T5 i18n            T6 file-tree 重构(app)

Layer 1:
  T7 server routes ── 依赖 T1, T2, T3
  T8 ApiClient ─────── 依赖 T2 (仅类型)

Layer 2:
  T9 skill-panel + ProjectPanel 接线 ── 依赖 T4, T5, T6, T8
  T10 最终验证 (lint/build/test/i18n check)
```

全局约定：
- 每个 task 结束自带其 lint + 该 package 测试，绿了才算完成。
- TypeScript strict；ESM；路径安全走 `@spherse/core` 的 `resolveProjectPath` / `isPathInside`。
- 写文件并发安全走 `FileWriteMutex`。
- 不加注释（除非用户要求）。

---

## T1 — Access policy 放行 skills 类别

**包**：`packages/core`
**改动**：`src/access/access-policy.ts` — `SRV_READ` 与 `SRV_WRITE` 各加入 `"skills"`。
**测试**：`__tests__/access-policy.test.ts`（若已存在则补 case）断言：`.spherse/skills/x/SKILL.md` 可读可写；`.spherse/project.yaml`、`.spherse/agents/.../profile.md`、`.spherse/theme.css` 仍被拒（read & write）。
**deps**：无。
**verify**：`npm test --workspace=packages/core`、`npm run lint --workspace=packages/core`。

## T2 — 新增 skill 创建/安装 contracts

**包**：`packages/server`
**改动**：`src/contracts/skills.ts` 新增
- `skillCreateRequest = Type.Object({ name, description, instructions: Type.String() })`
- `skillInstallRequest = Type.Object({ zipPath: Type.String() })`
- 对应 `Static` 类型导出
- `schemas` 汇总内加入两项；响应复用既有 `skillDefinition`。
- `contracts/index.ts` 汇总导出。
**测试**：参照既有 contract 测试，断言合法/非法 body 的 parseContract 行为。
**deps**：无。
**verify**：`npm test --workspace=packages/server`、`npm run lint --workspace=packages/server`。

## T3 — SkillStore createSkill / installSkill（含 adm-zip）

**包**：`packages/core`
**改动**：skill 写逻辑实现在 **`SkillStore`**（`src/store/skill.ts`，已拥有 skill 读取；与 `ProjectStore.createAgent` 写逻辑在 store 的模式一致）：
- root `package.json` 增加 `adm-zip` + `@types/adm-zip`（dev）依赖；如需可放 core deps（实现时确认 install location；adm-zip 纯 JS 无 native，Electron 打包安全）。
- `SkillStore` 新增自有 `FileWriteMutex` 字段（以 skill 目录为 key 串行化 create/install）。
  - `createSkill(name, description, instructions)`：校验 name（非空、不含 `/ \ :`、不以 `.` 开头；与前端 `INVALID_NAME_RE` 一致），description 非空；目标 `.spherse/skills/{name}/` 已存在 → `ConflictError`；建目录 + mutex 写 `SKILL.md`（`matter.stringify` frontmatter）；返回 `this.get(name)`。
  - `installSkill(zipPath)`：adm-zip 读 zip；校验顶层单一目录 + `{folder}/SKILL.md` + frontmatter 合法 + `name===folder`；逐条 zip-slip（`isPathInside`，拒绝绝对路径/`..`/越界）；冲突 `ConflictError`；原子化（`os.tmpdir()` 解压 → 校验 → `moveDirAtomic` 移入，mutex key 同为 skill 目录，`try/finally` 清理 temp）；返回 `this.get(folder)`。
- `ProjectManager.createSkill/installSkill` 改为纯委托 `projectStore.skill.createSkill(...)/installSkill(...)`（与 `listSkills`/`getSkill` 一致，PM 保持 facade）。
- `ConflictError` 在 `@spherse/core` errors（server 映射 → 409）。
**测试**：`packages/core/src/__tests__/store/skill.test.ts`（追加 create/install describe，复用现有 `createTempProject`/`writeFile`/`pathExists` helpers + `new SkillStore(skillDir)`）覆盖：createSkill 成功/重名/非法 name；installSkill 合法 zip 成功 / 缺 SKILL.md / frontmatter 非法 / 顶层多目录 / Zip Slip 条目 / 同名冲突 / 失败不残留半成品。用真实临时目录 + 临时 zip 文件。
**deps**：无（contracts 不被 core 依赖；adm-zip 在 core）。
**verify**：`npm test --workspace=packages/core`、`npm run lint`。

## T4 — Electron IPC：select-skill-zip

**包**：`packages/app`（electron）
**改动**：
- 新建 `electron/ipc/skill.ts`：`export function registerSkillIpc(getWindow)`；handler `select-skill-zip` 用 `dialog.showOpenDialog(win, { properties:["openFile"], filters:[{name:"Zip",extensions:["zip"]}] })`，返回绝对路径或 `null`。
- `electron/ipc/index.ts` 的聚合函数内 `import { registerSkillIpc }` 并调用。
- `electron/preload.ts` 暴露 `selectSkillZip: () => ipcRenderer.invoke("select-skill-zip")`。
- 共享 `@shared/electron-api.ts` 的 `ElectronAPI` 类型新增 `selectSkillZip(): Promise<string|null>`。
**deps**：无。
**verify**：`npm run lint --workspace=packages/app`、`npm run typecheck`（若 app 提供；否则 `npm run build --workspace=packages/app` 走 ts）。

## T5 — i18n 文案（zh-CN 基准 + en + zh-TW）

**包**：`packages/i18n`
**改动**：`src/locales/zh-CN.ts`（基准，每条带 UI 场景注释）+ `en.ts` + `zh-TW.ts` 新增 key（命名见 design §4.8）：
`project-panel.skills`、`skill-panel.create`、`skill-panel.install`、`skill-panel.empty`、`skill-panel.createDialog.{title,nameLabel,descriptionLabel,contentLabel,submit,cancel}`、`skill-panel.create.{success,failed,exists}`、`skill-panel.install.{success,failed,exists,malformed}`、`skill-panel.nameInvalid`。
**deps**：无。
**verify**：`npm test --workspace=packages/i18n`、`npm run lint`。注意保持三 locale key 集合一致（i18n check 会校验）。

## T6 — 前端重构：file-tree → base component + user-file-panel feature

**包**：`packages/app`
**改动**：
- 新建 `src/components/file-tree/`，从 `features/file-tree/` 迁入：`tree-model.ts`、`FileTree`(`index.tsx`)、`FileTreeNode.tsx`、`file-tree-context.tsx`、`hooks/useFileTreeController.ts`、`hooks/useFsWatchRefresh.ts`、`FileTreeContextMenu.tsx`、`DeleteConfirmDialog.tsx`、`InlineNameInput.tsx`。更新全部 import。
- base `FileTree` 增加 `rootPath?: string`（默认 `""`）；controller 用 `rootPath` 作为 list 基准（初始 load、refreshRoot、submitCreate 顶层判断、根级 InlineNameInput 触发）。节点 `path` 保持「相对项目根」完整路径。
- 新建 `src/features/user-file-panel/`：`UserFilePanel` 承载原 ProjectPanel 的 Files `SidebarGroup`（`SidebarGroup`+`Label`+`Action`(AI 读黑名单入口)+`Content`→`<FileTree/>`）；把 `AiReadDenylistDialog.tsx` 从旧 file-tree 迁入此 feature。`selectedFilePath`/`onSelectFile`/`onDeleted` 由本 feature 自治（`useProjectCtx`+`useNavigate`+`useSearchParams`）。
- `features/project-panel/index.tsx` 退化为薄组合：渲染 `<AgentSessionList/> <UserFilePanel/>`（SkillPanel 留给 T9 接）；保留 `SidebarProvider` 与 `useSidePanel` 浮动/隐藏逻辑。
- 删除/清空旧 `features/file-tree/`（迁出后）。
- 更新所有引用旧路径的 import（grep `features/file-tree`）。
**测试**：更新 `ProjectPanel.structure.test.ts`（侧边栏浮动/隐藏类断言不变，仅数据流来源改为 `<UserFilePanel>`）；base `FileTree` 参数化单测（`rootPath` 驱动 list 基准、节点路径为完整路径）；user-file-panel section 渲染测试。
**deps**：无（纯前端，与后端并行）。
**verify**：`npm run lint --workspace=packages/app`、`npm test --workspace=packages/app`、`npm run build --workspace=packages/app`。

## T7 — Server routes：POST /skills + POST /skills/install

**包**：`packages/server`
**改动**：`src/routes/skills.ts`：
- `POST /api/projects/:projectId/skills`：`schema.body = schemas.skillCreateRequest`，`response.200 = schemas.skillDefinition`；handler 调 `req.projectCtx!.projectManager.createSkill(...)`，conflict → `409`（用 `conflict()` from `errors.ts`）。
- `POST /api/projects/:projectId/skills/install`：`schema.body = schemas.skillInstallRequest`；handler 调 `projectManager.installSkill(zipPath)`；malformed/conflict → 400/409 可读 message。
- 响应用 `parseContract(schemas.skillDefinition, ...)` 做边界校验。
**测试**：contract test 覆盖 create 成功/409；install 成功/冲突/malformed（构造 tmp zip）；并验证 `GET/PUT/DELETE /content/.spherse/skills/...` 在 T1 放行后可用（一条 happy-path 即可）。
**deps**：T1、T2、T3。
**verify**：`npm test --workspace=packages/server`、`npm run lint`。

## T8 — ApiClient：createSkill / installSkill

**包**：`packages/app`
**改动**：`src/lib/api.ts`：
- `createSkill(name, description, instructions)` → `POST ${apiBase}/skills`，JSON body，`parseApiResponse(schemas.skillDefinition)`。
- `installSkill(zipPath)` → `POST ${apiBase}/skills/install`，JSON body，同 schema。
- import 需要的 contract 类型/schemas from `@spherse/server/contracts`。
**deps**：T2（类型/schemas）。runtime 依赖 T7，但编译不依赖。
**verify**：`npm run lint --workspace=packages/app`、`npm run build --workspace=packages/app`。

## T9 — skill-panel feature + ProjectPanel 接线

**包**：`packages/app`
**改动**：新建 `src/features/skill-panel/`：
- `index.tsx` 导出 `SkillPanel`：Skills `SidebarGroup`（`Label`=skills、`Action`=`MoreHorizontalIcon`→`DropdownMenu`[创建技能/安装技能]、`Content`→base `<FileTree rootPath=".spherse/skills" selectedFilePath onSelectFile onDeleted />`）。`handleSelectFile`/`handleFileDeleted` 在本 feature 自治（逻辑同 Files：navigate content、删除回退）。`useState` 管 `createOpen`。
- `CreateSkillDialog.tsx`：shadcn `Dialog`，三字段（名称/描述/内容 textarea）；名称内联校验（`INVALID_NAME_RE`）禁用提交 + `skill-panel.nameInvalid`；提交 `client.createSkill(...)`，成功关弹窗 + toast，失败 toast（409→`create.exists`，其它→`create.failed`）。
- 安装流程：`window.electronAPI.selectSkillZip()` → `client.installSkill(zipPath)` → 成功 toast；错误按 message 映射 toast（含 "already exists" → `install.exists`；其余 → `install.failed`，服务器 message 会指明具体原因）；取消无操作。
- **刷新机制**：不使用主动 `refreshKey`。统一走被动链路——server `fs-watcher` `WATCHED_CATEGORIES` 含 `skills`（见 T7 修复），`.spherse/skills/**` 变更经 bus 推 `fs-watch` → `useFsWatchRefresh` 防抖 300ms → `refreshRoot`。与 Files 面板一致。
- `src/features/project-panel/index.tsx` 在 `<UserFilePanel/>` 后追加 `<SkillPanel/>`。
**测试**：skill-panel section 渲染 + CreateSkillDialog 提交/校验；更新 `ProjectPanel.structure.test.ts` 断言含 `<SkillPanel/>`。
**deps**：T4（IPC）、T5（i18n）、T6（base FileTree）、T8（ApiClient）。runtime 还需 T7 后端，但单测可 mock client。
**verify**：`npm run lint --workspace=packages/app`、`npm test --workspace=packages/app`、`npm run build --workspace=packages/app`。

## T10 — 最终验证

**命令**：`npm run verify`（lint + build + unit tests + i18n check）。
- 视变更面跑相关 E2E：`npm run test:e2e --workspace=packages/app -- e2e/file-tree.spec.ts`（涉及 file-tree 重构/路由/store）。合并前再 `npm run verify:e2e`。
- 人工冒烟：开/建项目 → Skills section 浏览 `.spherse/skills` → 点文件进 content browser → 创建技能（合法/重名/非法名）→ 安装 zip（合法/冲突/非法）→ 删除技能文件夹。
**deps**：全部。

---

## 并行调度建议（subagent-driven）

- **Wave 1（6 并行）**：T1, T2, T3, T4, T5, T6
- **Wave 2（2 并行）**：T7（需 T1/T2/T3）, T8（需 T2）
- **Wave 3**：T9（需 T4/T5/T6/T8）
- **Wave 4**：T10

注：T3 与 T6 都改文件但不同 package（core vs app），无写冲突可并行。T6 是 app 内最大重构，建议优先派发。

## 风险点（实现期重点）

- **T6 回归**：file-tree 迁移 + 参数化是唯一会影响既有 Files 行为的改动；务必保留 `rootPath=""` 默认 + 完整路径节点 + structure test 断言。先做 T6 再做 T9 可隔离问题。
- **T3 Zip Slip**：逐条校验解压目标落在技能目录内；用 `isPathInside`，勿用 `startsWith`。
- **T3 原子化**：tmp 解压 → 校验 → rename；失败清理 tmp，不留半成品。
- **T7 端口/zip**：install 接收绝对 zipPath，服务端本地读盘（同 `images/export` 模式）。
