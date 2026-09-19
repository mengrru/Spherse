# 项目市场（Project Marketplace）设计

- 日期：2026-09-19
- 状态：设计已确认，待实施

## 背景与目标

当前添加项目的唯一入口是 ActivityBar 左下角「添加项目」按钮，点击直接弹系统文件管理器。引入项目市场后：

- **体验侧**：该按钮改为弹出菜单，含「市场」与「本地」两个选项。「本地」保持现有选目录打开流程；「市场」打开项目市场 Dialog，顶部分类菜单（第一项「全部」）+ 卡片网格，点击「下载」后先选保存位置，由 server 完成下载、解压、落盘，随后自动打开该项目。
- **发布侧**：复用 `spherse-assets` 仓库的发布模式——项目源文件放 `projects/` 目录，GitHub Actions 手动触发生成 manifest 并上传 zip 到 OSS，客户端读 manifest。

与技能市场的关键差异：项目市场入口在**没有活跃项目**时（welcome 页）就要可用，因此路由必须是全局的（不带 `:projectId` 前缀）。server 随应用启动即监听，全局路由有现成先例（`GET /api/projects`），无启动时序障碍。

## 已确认的决策

| 决策点 | 结论 |
|---|---|
| 入口形态 | 左下角按钮改为 DropdownMenu（复刻同区域 DebugMenu 样板），菜单项「市场」「本地」；沿用 `open-project` feature flag，desktop-only（web 端 ActivityBar 本就不渲染） |
| 下载交互 | 一阶段：点「下载」→ 先弹目录选择框选保存位置 → 一次 API 完成下载+解压+落盘，返回 `projectRoot` 后复用现有 `open-project` 链路打开项目 |
| 安装管线归属 | 不泛化 `open-sample-project` IPC（它已实现选目录→确认→重命名→复制→注册一条龙，但网络/SSRF/限流逻辑必须留在 server，与技能市场架构一致且契约测试可覆盖；sample 管线在 main 进程内不可 web 测试，两管线并存的成本可接受） |
| 同名冲突 | 自动重命名：`{name}`、`{name}-2`、`{name}-3`…（从 2 起，与 sample 安装约定一致；上限 100，耗尽报错）；并发竞争下 rename 的 ENOTEMPTY/EPERM 兜底映射为 `ConflictError` |
| 已安装/更新状态 | v1 不做。meta.json 打包时排除，落盘后无市场来源信息，所有卡片只有「下载」按钮；后续可通过在 `.spherse/project.yaml` 记录来源再加 |
| 分类 | meta.json 自由字符串 `category`，UI 从 manifest 条目动态归并去重，「全部」排第一，类别名原样显示 |
| 元数据文件 | 项目根目录 `meta.json`（自定义 schema，打包 zip 时仅排除**顶层** `{name}/meta.json`，项目内嵌套的 meta.json 保留） |
| 路由归属 | 全局路由 `/api/marketplace/projects*`（无 projectId 前缀），manifest 读取与安装均不依赖活跃项目 |
| zip 上限 / 下载超时 | 100MB（区别于技能的 50MB）/ 300s（区别于技能的 60s，避免慢网络撞超时） |
| 空目录发布语义 | 与 skills 对齐：本地空 + 远端非空 → 警告后照常发布（manifest 支持下架语义的极端情况）；双方皆空 → 非零退出 |
| 交付范围 | 体验侧代码 + `spherse-assets` 仓库发布管线两侧都交付 |

## 总览架构

```
[spherse-assets 仓库]
   │ GitHub Actions（workflow_dispatch，input resource: skills | projects）
   │ publish-projects.mjs：读 meta.json → diff manifest → 打 zip（排除 meta.json）→ ossutil 上传
   ▼
[阿里云 OSS（现有 bucket，公共读）]
   spherse/projects/manifest.json
   spherse/projects/{name}/{version}/{name}-{version}.zip
   ▲ fetch（server 代理，30s 缓存）        ▲ fetch 下载 zip
[Spherse server（全局路由，零项目可用）]
   │ GET  /api/marketplace/projects          → manifest 代理
   │ POST /api/marketplace/projects/install  → 下载 zip → core 解压落盘 → { projectRoot }
   ▼
[ProjectMarketDialog (packages/app)]
   下载 → selectDirectory → install API → openProjectAtPath → 打开项目
```

## OSS 布局与 manifest 格式

```
spherse/projects/manifest.json                                 ← 全量清单，每次发布覆盖上传
spherse/projects/{name}/{version}/{name}-{version}.zip         ← 版本化 zip，不可变
```

manifest.json：

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-19T00:00:00Z",
  "projects": [
    {
      "name": "my-world",
      "description": "……",
      "version": "1.2.0",
      "category": "游戏",
      "zipUrl": "https://…/spherse/projects/my-world/1.2.0/my-world-1.2.0.zip",
      "size": 20480,
      "updatedAt": "2026-09-19T00:00:00Z"
    }
  ]
}
```

### 项目源文件 meta.json（spherse-assets 仓库内，打包时排除）

```jsonc
{
  "name": "my-world",        // 必填，必须等于目录名，符合名称规则（禁 / \ :、禁 . 开头）
  "description": "……",       // 必填，非空
  "version": "1.2.0",        // 必填，semver
  "category": "游戏"          // 必填，非空自由字符串，UI 原样显示
}
```

zip 内顶层目录 = 项目名，与技能包一致；内容任意（可以是任意文件夹，`.spherse/` 可有可无，打开时由 `createProject` 决定是否初始化）。

## 体验侧设计

### contracts（packages/contracts）

新文件 `src/project-marketplace.ts`（镜像 `marketplace.ts` 的组织方式，导出面经 `index.ts` 汇出）：

- `marketplaceProjectEntry`：name / description / version / category / zipUrl / size / updatedAt
- `marketplaceProjectManifestResponse`：schemaVersion / generatedAt / projects
- `projectMarketplaceInstallRequest`：`{ name, version, destDir }`
- `projectMarketplaceInstallResponse`：`{ projectRoot }`

### server（packages/server）

**marketplace.ts 泛化**：`createMarketplaceService` 参数化四项——`manifestResponseSchema`（契约校验用）、entry 最小接口 `{ name, zipUrl }`（收窄 `downloadZip(entry)` 入参类型）、`maxZipBytes`、`zipDownloadTimeoutMs`、`tmpPrefix`（SSRF origin 校验、流内计数、30s 缓存逻辑不变）；保留 skills 单例，新增 `projectMarketplaceService` 单例：

- manifest URL：`${OSS_BUCKET_BASE_URL}/projects/manifest.json`，支持环境变量 `SPHERSE_PROJECT_MARKETPLACE_MANIFEST_URL` 覆盖（测试/E2E stub 用）
- zip 上限 100MB（`MAX_PROJECT_ZIP_BYTES`）、下载超时 300s

**新路由 `src/routes/project-marketplace.ts`**（注册进 `routes/index.ts`；不带 projectId，不经过 project preHandler，鉴权由全局 auth onRequest hook 覆盖）：

- `GET /api/marketplace/projects` → 代理 manifest（响应经 contract 校验）
- `POST /api/marketplace/projects/install`：
  1. manifest 找 `name` 条目；无 → 404
  2. 条目 `version` ≠ 请求 `version` → 409（manifest 已更新，客户端应刷新）
  3. `destDir` 校验：必须绝对路径（`path.isAbsolute`）、必须存在且为目录，否则 400
  4. 下载 zip（SSRF origin 校验）→ `installMarketplaceProjectZip(zipPath, destDir)`（core）
  5. `finally` 清理临时 zip，返回 `{ projectRoot }`

项目注册不在 install 路由内做——返回 `projectRoot` 后由 renderer 走现有 `open-project` IPC（含不安全位置确认弹窗）完成注册，保证与本地打开项目行为完全一致。

### core（packages/core）

新模块 `src/marketplace-project.ts`，导出：

```ts
installMarketplaceProjectZip(zipPath: string, destDir: string):
  Promise<{ projectRoot: string; folderName: string }>
```

流程（复用 `SkillStore.installSkill` 的骨架，见 `store/skill.ts`）：

1. 校验 zip 非空；顶层有且仅一个目录；顶层目录名通过名称规则（禁 `/ \ :`、禁 `.` 开头）
2. 全部 entry 做 zip-slip 检查（`isPathInside`，逐条 `path.resolve`）
3. 解压到 `os.tmpdir()/marketplace-project-{nanoid}`（先校验后解压）
4. 目标目录自动重命名：`{folderName}`、`{folderName}-{i}`（i = 2..100，`existsSync` 探测，序号从 2 起与 sample 安装一致），耗尽抛 `ConflictError`；`rename` 因并发竞争失败（ENOTEMPTY/EPERM）时兜底映射为 `ConflictError`
5. 顶层目录原子移入 destDir（rename，EXDEV 时 cp+rm 兜底；将 `store/skill.ts` 的 `moveDirAtomic` 抽到共享 util 供两处复用）
6. `finally` 清理解压临时目录；失败时保证已移动的目标清理（部分成功回滚）

不使用 `FileWriteMutex`：目标目录由用户刚在原生对话框选定，不存在并发写竞争。不校验 zip 内是否含 `.spherse`（项目可以是任意文件夹）。

### app（packages/app）

**API client（`lib/api.ts`）**：新增 `createGlobalApiClient(baseUrl, accessToken?)`——与 `createApiClient` 共享 authedFetch 构造；方法：`listMarketplaceProjects()`、`installMarketplaceProject(req)`。`lib/use-connection.ts` 新增 `useGlobalApiClient()`（baseUrl 为空时返回 null）。

**queries**：新全局 key 命名空间 `["marketplace", "projects"]`（与 `projectQueryKeys` 平行；`staleTime: 0`，与技能市场一致每次打开拉新）；`queries/marketplace-projects.ts` 提供 `useMarketplaceProjects(enabled)`。

**activity-bar（`features/activity-bar/index.tsx`）**：PlusIcon 按钮改为 `DropdownMenuTrigger render={<Button …/>}`（复刻 `debug-tools/DebugMenu.tsx` 样板，`side="right" align="start"`），菜单项：

- 「市场」→ 打开 `ProjectMarketDialog`
- 「本地」→ 现有 `handleAddProject()`（selectDirectory → openProject 流程不变）

**新 `features/project-market/ProjectMarketDialog.tsx`**（复用 `components/ui/dialog.tsx`）：

- TanStack Query 拉 manifest；loading / error（含重试）/ 空态三分支
- 顶部分类 chips：第一项固定「全部」，后续为 manifest 条目 `category` 按出现顺序去重；横向排列、可滚动；选中态高亮
- 卡片网格（`grid grid-cols-1 sm:grid-cols-2`，同技能市场）：name、`v{version}`、description（line-clamp-3）、category badge、updatedAt
- 按钮状态机：`idle | downloading | error`（spinner / 重试）；无「已安装/更新」态
- `handleDownload(card)`：
  1. `bridge.project?.selectDirectory()`（复用现有 IPC，含 createDirectory）；取消（null）→ 静默中止
  2. `client.installMarketplaceProject({ name, version, destDir })` → `{ projectRoot }`
  3. 成功 → `openProjectAtPath(bridge, projectRoot)` → `navigate(buildProjectRoute(…))` → 关闭 Dialog
  4. 409 → toast + invalidate manifest query；其他错误 → 卡片 error 态 + toast

**app-store**：新增 `openProjectAtPath(bridge, projectRoot): Promise<string | null>`——即 `openProject` 去掉 selectDirectory 的变体：`findProjectIdByPath` 命中则 `setActiveProject` 返回已有 id；否则 `bridge.project.openProject(projectRoot)` → `registerProject` → 返回 projectId。

**desktop**：无新 IPC（`select-directory` / `open-project` 全复用）。

**web**：不改（ActivityBar 在 web 不渲染，`open-project` flag 本就 electron-only）。

**i18n**：按 i18n skill 流程添加三语文案；key 计划：

- `activity-bar.openProjectMenu.market` / `activity-bar.openProjectMenu.local`
- `project-market.*`：`title`（项目市场）、`categoryAll`（全部）、`download`（下载）、`downloading`、`downloadFailed`、`manifestRefreshed`（409 toast）、`empty`、`footerNote`（内容来自社区发布仓库等说明）

## 发布侧设计（spherse-assets 仓库）

```
spherse-assets/
├── projects/                            ← 项目源目录（本次新增）
│   └── {project-name}/
│       ├── meta.json                    # name/description/version/category
│       └── …                            # 任意项目内容
├── scripts/
│   ├── publish-skills.mjs               # 现有
│   └── publish-projects.mjs             # 本次新增
└── .github/workflows/publish.yml        # input resource 增加 projects 选项
```

### publish-projects.mjs 流程（镜像 publish-skills.mjs）

1. 扫描 `projects/`，解析每个 `meta.json`，校验：`name` 与目录名一致且符合名称规则、`description` 非空、`version` 合法 semver、`category` 非空字符串
2. 从仓库全量生成新 manifest（zipUrl 按 OSS 路径规则 `spherse/projects/{name}/{version}/{name}-{version}.zip` 构造）；**未重新打包的条目沿用远端 manifest 的 `size` / `updatedAt`**
3. fetch OSS 当前 manifest（404 视为空；URL 可用 `SPHERSE_PROJECTS_MANIFEST_URL` 覆盖），diff：条目新增或 `version` 变化的项目 → 待发布集合
4. 待发布项目逐个打 zip（adm-zip `addLocalFolder(dir, name, filter)`，**顶层目录 = 项目名；filter 仅排除顶层 `{name}/meta.json`，按路径判定（dirname === 项目目录），不按文件名 basename 匹配，避免误删项目内嵌套的 meta.json**）到 `dist/spherse/projects/`，回填 `size` / `updatedAt` 到 manifest
5. 输出 `dist/spherse/projects/manifest.json` + 待上传 zip 清单
6. 空目录语义与 skills 对齐：本地空 + 远端非空 → 警告后照常发布（支持全量下架的极端语义）；双方皆空 → 非零退出

与 publish-skills 的共享逻辑（diff、semver/名称校验、manifest merge、远端 manifest fetch）抽 `scripts/lib/` 小模块复用（空目录语义相同，无需参数化），差异只留元数据解析（meta.json vs SKILL.md frontmatter）与打包 filter。

### publish.yml 改动

- input `resource`（choice）增加 `projects`
- steps 按 resource 分支：`projects` → `node scripts/publish-projects.mjs` → ossutil 上传 `dist/spherse/projects/**/*.zip` → 最后覆盖上传 `spherse/projects/manifest.json`（manifest 最后上传，与 skills 一致）
- secrets/vars 复用现有配置，无新增

### 语义约定（与 skills 一致）

- 内容变更必须 bump `version`；版本没变的内容变更不会发布
- 下架 = 从仓库删目录；OSS 旧 zip 保留作不可变历史
- 首次发布：OSS manifest 404 → 全量发布

## 错误处理与安全

| 场景 | 行为 |
|---|---|
| manifest 拉取失败 | Dialog 错误态 + 重试按钮 |
| 安装时 manifest 已更新（version 不匹配） | 409；toast 提示并自动 refetch 刷新卡片 |
| 用户取消目录选择 | 静默中止，不发请求 |
| destDir 非绝对路径 / 不存在 / 非目录 | 400；卡片 error + toast |
| zip 下载失败 / 超大小 / 空 zip | 502；卡片 error + 重试 |
| zip 结构非法（多顶层目录、路径逃逸、顶层名非法） | core `ValidationError` → 400；tmp 已清理，dest 无残留 |
| 同名冲突耗尽（-2 到 -100 都存在） | `ConflictError` → 409 |
| 安装成功但打开失败（如用户在不安全位置确认框点了取消） | 项目已落盘；toast 提示可稍后从项目列表打开（目录已在，重新打开即可） |
| destDir 位于不安全位置（应用安装目录内） | 与本地打开项目一致：**落盘后**经 `open-project` 的 `confirmUnsafeLocation` 确认（注意与 sample 流程的落盘前确认不同；unsafe zone 仅应用安装目录，面窄，最坏情况是目录写入后用户取消打开、目录残留可重开，接受此差异并记录） |

安全要点：

- **SSRF 防线**：renderer 只传 `{ name, version, destDir }`；zipUrl 由 server 从 manifest 解析，下载前校验 origin === manifest origin
- **zip 校验**：单一顶层目录、全 entry zip-slip 检查、100MB 上限（下载流内计数）；zip-bomb 展开大小硬化沿用现有 backlog 条目（adm-zip hardening），不在本次范围
- **鉴权**：全局路由处于 `/api/` 前缀下，token 模式下由现有 auth onRequest hook 覆盖
- **destDir 来源**：由原生对话框选定 + server 端绝对路径/目录类型校验；`assertInsideProject` 类项目内约束不适用（落盘目标在项目空间之外，由用户显式选择）

## 测试策略

- **contracts**：`packages/contracts/src/__tests__/api-contracts.test.ts` 补 project-marketplace schema 契约测试
- **core 单测**（`__tests__/marketplace-project.test.ts`）：成功落盘、自动重命名链（从 `-2` 起，含 `{name}-2` 已存在的场景）、多顶层目录拒绝、zip-slip 拒绝、空 zip 拒绝、顶层名非法拒绝、重命名耗尽 ConflictError、dest 非目录 400、失败无残留
- **server 契约测试**（`__tests__/project-marketplace-routes.test.ts`，stub fetch + 真 fs）：manifest 代理（含 schema 校验失败 502）、install 404 / 409 / 400（相对路径、非目录）/ SSRF / 成功（验证磁盘上项目落盘、meta.json 不存在其中、响应 projectRoot 正确）
- **app 单测**：分类归并纯函数、卡片按钮状态、`openProjectAtPath` store 行为（新注册路径；去重分支为防御性代码，单测覆盖方法契约即可）
- **E2E（packages/desktop）**：`SPHERSE_PROJECT_MARKETPLACE_MANIFEST_URL` 注入本地 stub server 提供测试 manifest 与 zip；`select-directory` 现无注入点，需**扩展 E2E seam**（仿 `SPHERSE_E2E_DIALOG_RESPONSE` 模式，`select-directory` handler 支持 `SPHERSE_E2E_SELECT_DIRECTORY` 环境变量直接返回测试目录）；链路：菜单 → 市场 Dialog → 分类筛选 → 下载 → 项目打开。注：stub server 与 seam 均为新基建（技能市场当年计划的 E2E 未交付，无可复用），工时按新建估
- **发布侧**：publish-projects.mjs 本地 dry-run 单测（tmp 目录模拟 `projects/` + mock 旧 manifest；校验 meta.json 校验、diff 逻辑、**zip 内不含顶层 meta.json 且嵌套 meta.json 保留**、顶层目录名、**未变更条目沿用远端 size/updatedAt**、空目录语义对齐 skills）

## 交付物清单

1. `packages/contracts`：`project-marketplace.ts` 4 个 schema + 导出 + 契约测试
2. `packages/core`：`installMarketplaceProjectZip` + `moveDirAtomic` 抽共享 util（含单测）
3. `packages/server`：marketplace service 泛化 + project 单例 + 2 个全局路由（含契约测试）
4. `packages/app`：全局 API client + query + ActivityBar 菜单改造 + `ProjectMarketDialog` + `openProjectAtPath`（含单测）+ i18n 三语
5. `packages/desktop`：`select-directory` E2E seam（`SPHERSE_E2E_SELECT_DIRECTORY`）+ E2E 一条 happy path
6. `spherse-assets`：`projects/` 目录 + `publish-projects.mjs`（含 dry-run 单测）+ workflow `projects` 选项 + README 更新
7. 文档同步：`docs/official/project-structure.md`（新文件）、marketplace 相关域文件、testing、data-conventions 如涉及、`docs/dev/backlog.md`

## Review 记录（2026-09-19 sub agent review）

无 critical。已采纳并修订：E2E seam 需扩展（Important 1）、空目录发布语义对齐 skills 实际行为（Important 2）、service 泛化需参数化 schema/entry/timeout（Important 3）、100MB 配套 300s 超时（Medium 4）、unsafe 确认时序差异显式记录（Medium 5）、zip filter 仅排除顶层 meta.json + 嵌套保留用例（Medium 6）、未变更条目 size/updatedAt 沿用 + 用例（Medium 7）、ENOTEMPTY 兜底（Minor 8）、重命名序号从 -2 起与 sample 统一（Minor 9）、project-structure.md 入同步清单（Minor 12）、sample IPC 复用与否入决策表（替代方案）。未采纳：Minor 10（AdmZip 内存峰值，已在 backlog adm-zip hardening 条目覆盖 projects 链路，本次不做）；Minor 11（openProjectAtPath 去重分支保留为防御性代码）。
