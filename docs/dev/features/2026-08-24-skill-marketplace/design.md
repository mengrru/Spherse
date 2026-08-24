# 技能市场（Skill Marketplace）设计

- 日期：2026-08-24
- 状态：设计已确认，待实施

## 背景与目标

用户在 Spherse 中只能通过面板手动创建技能或从本地 zip 安装。引入技能市场后：

- **体验侧**：从 skill panel 右上角菜单进入「技能市场」Dialog，浏览 OSS 上的技能清单，一键安装/更新到当前项目。
- **发布侧**：新建 `spherse-assets` 资源仓库管理技能包源文件，通过 GitHub Actions 手动触发发布 pipeline，生成 manifest 并将有变更的技能打包上传到 OSS。

## 已确认的决策

| 决策点 | 结论 |
|---|---|
| 安装层级 | Project 级（`.spherse/skills/`），复用现有安装管线，不引入用户级 |
| 更新语义 | 支持覆盖安装；manifest 含 version，客户端比较版本显示「更新」 |
| 版本号来源 | 技能源文件 `SKILL.md` frontmatter `version` 字段（semver） |
| 发布粒度 | pipeline 拉取 OSS 现有 manifest 与新生成的全量 manifest 对比，仅上传版本变化的技能 zip |
| OSS | 共用现有 bucket，市场内容放 `spherse/skills/` 路径，公共读 |
| UI 形态 | 居中模态 Dialog，卡片网格 |
| 下载链路 | 方案 A：server 代理 manifest + server 下载 zip；renderer 只传 `{ name, version }` |
| 交付范围 | 体验侧代码 + `spherse-assets` 仓库骨架（目录、脚本、workflow）两侧都交付 |
| 发布仓库定位 | 通用静态资源发布仓库（skills 本次实现，samples 等未来扩展） |

## 总览架构

```
[spherse-assets 仓库]
   │ GitHub Actions（workflow_dispatch 手动触发）
   │ publish-skills.mjs：diff manifest → 打 zip → ossutil 上传
   ▼
[阿里云 OSS（现有 bucket，公共读）]
   spherse/skills/manifest.json
   spherse/skills/{name}/{version}/{name}-{version}.zip
   ▲ fetch（server 代理，30s 缓存）        ▲ fetch 下载 zip
[Spherse server] ────────────────────────┘
   │ REST（contracts schema）
   ▼
[MarketplaceDialog (packages/app)]
   安装 → server 校验 → installSkill(zip, overwrite) → .spherse/skills/
```

## OSS 布局与 manifest 格式

```
spherse/skills/manifest.json                               ← 全量清单，每次发布覆盖上传
spherse/skills/{skill-name}/{version}/{name}-{version}.zip ← 版本化 zip，不可变
```

manifest.json：

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-24T00:00:00Z",
  "skills": [
    {
      "name": "my-skill",
      "description": "……",
      "version": "1.2.0",
      "zipUrl": "https://…/spherse/skills/my-skill/1.2.0/my-skill-1.2.0.zip",
      "size": 4096,
      "updatedAt": "2026-08-24T00:00:00Z"
    }
  ]
}
```

要点：

- **zip 版本化路径 + 不可变**：每次发版新路径，天然支持回滚与缓存，manifest 指向唯一确定内容。
- **`version` 来自 SKILL.md frontmatter**；本地手动创建的技能无 `version`，视为「未知版本」，市场只显示已安装、不显示更新。
- **manifest URL 为 server 端常量**（跟随 `packages/desktop/electron/updater.ts` 的硬编码模式），不进用户 settings：
  `https://mengru-open-source.oss-cn-beijing.aliyuncs.com/spherse/skills/manifest.json`

## 体验侧设计

### core（packages/core）— 仅两处最小改动

marketplace 网络逻辑不进 core（放 server），core 只扩展落盘管线：

1. `SkillStore.installSkill(zipPath, options?: { overwrite?: boolean })`
   - 覆盖模式：解压校验通过后，旧目录先移到 tmp 再原子移入新目录；任一步失败可回滚（旧目录移回），全程 `FileWriteMutex` 保护。
   - 非 overwrite 行为不变：同名目录抛 `ConflictError`。
2. `SkillDefinition` 增加可选 `version?: string`；`parseSkill` 解析 frontmatter 中的 `version`。

### server（packages/server）— 持有全部网络逻辑

- `src/contracts/marketplace.ts` 新文件（typebox，两端复用）：
  - `marketplaceSkillEntry`：name / description / version / zipUrl / size / updatedAt
  - `marketplaceManifestResponse`：schemaVersion / generatedAt / skills
  - `skillMarketplaceInstallRequest`：`{ name, version }`
- `MARKETPLACE_MANIFEST_URL` 常量 + 30s 内存缓存的 manifest 代理；常量支持环境变量 `SPHERSE_MARKETPLACE_MANIFEST_URL` 覆盖（测试/E2E 起 stub server 用）。
- 新 routes（注册进 `routes/index.ts`）：
  - `GET /api/projects/:projectId/marketplace/skills` → 代理 manifest（响应经 contract 校验）。
  - `POST /api/projects/:projectId/skills/marketplace-install`：
    1. fetch manifest → 找到 `name` 条目；不存在 → 404
    2. 条目 `version` ≠ 请求 `version` → 409（manifest 恰好更新，客户端应刷新）
    3. 校验 zipUrl host === manifest URL host（防 SSRF）→ 下载 zip 到 `os.tmpdir()`（复用 skill-install tmp 模式）
    4. `projectManager.installSkill(zipPath, { overwrite: true })` → finally 清理 tmp
    5. 返回安装后的 `SkillDefinition`（含 version）

### app（packages/app）

- `features/skill-panel/index.tsx` 菜单新增「技能市场」项：**无 capability 门槛**（下载在 server，web/desktop 均可用）。
- 新增 `useProjectSkills()` query hook（复用已有 `GET /skills` API + `queries/keys.ts` key factory），供已安装匹配。
- 新组件 `features/skill-panel/MarketplaceDialog.tsx`（复用 `components/ui/dialog.tsx`）：
  - TanStack Query 拉 manifest；loading / error（含重试）/ 空态。
  - 卡片网格：name、description、市场版本、按钮。
  - 按钮状态推导（本地技能按 name 匹配）：

    | 本地状态 | 按钮表现 |
    |---|---|
    | 未安装 | 安装 |
    | 本地 version < 市场 version | 更新 |
    | version 相同 | 已安装（禁用） |
    | 本地无 version（手动创建） | 已安装（禁用，不提供更新） |

    外加 per-card `installing`（spinner）与 `error`（提示 + 重试）。
  - 安装成功 → invalidate skills query；FileTree 由现有 fs-watcher 自动刷新。
- semver 比较用 app 内部小 util（纯函数 + 单测，不引第三方库）。
- i18n：所有文案进 `@spherse/i18n`（`zh-CN.ts` 基准带场景注释，`en` / `zh-TW` 同步）。

## 发布侧设计（spherse-assets 新仓库）

```
spherse-assets/                        ← 通用静态资源发布仓库
├── skills/                            ← 技能源目录（本次实现）
│   └── {skill-name}/
│       ├── SKILL.md                   # frontmatter: name + description + version(semver)
│       └── ...                        # companion files（references/、scripts/ 等）
├── samples/                           ← 预留：示例项目等（本次仅空目录 + README 说明）
├── scripts/
│   └── publish-skills.mjs             # 技能发布脚本
├── .github/workflows/publish.yml      # workflow_dispatch，input: resource type (choice: skills)
├── package.json                       # 依赖：adm-zip、gray-matter
└── README.md                          # 发布流程 + secrets/vars 配置说明
```

仓库目录与 OSS 路径分区一一对应（`skills/` → `spherse/skills/`，`samples/` → `spherse/sample/`，后者与现有 landing 示例项目路径一致）。未来新增资源类型 = 新增目录 + 脚本 + workflow input 选项，互不干扰。

### publish-skills.mjs 流程

1. 扫描 `skills/`，解析每个 SKILL.md，校验：`name` 与目录名一致且符合 Spherse 命名规则（禁 `/ \ :`、禁 `.` 开头）、`description` 存在、`version` 为合法 semver。
2. 从仓库全量生成新 manifest（zipUrl 按 OSS 路径规则构造）。
3. fetch OSS 当前 manifest（404 视为空），diff：条目新增或 `version` 变化的技能 → 待发布集合。
4. 待发布技能逐个打 zip（adm-zip，**顶层目录 = 技能名**，符合 `installSkill` 单一顶层目录约定）到 `dist/`，回填 `size` / `updatedAt` 到 manifest。
5. 输出 `dist/manifest.json` + 待上传 zip 清单。
6. `skills/` 为空 → 非零退出（防误发空 manifest 清空市场）。

### publish.yml（手动触发）

- `workflow_dispatch` + input `resource`（choice，当前仅 `skills`）。
- steps：checkout → setup-node → `npm install` → `node scripts/publish-skills.mjs` → curl 官方 ossutil（linux amd64，与 Spherse `build-and-release.yml` 同款）→ 逐个 `ossutil cp dist/*.zip oss://$OSS_BUCKET/spherse/skills/{name}/{version}/…` → 最后 `ossutil cp dist/manifest.json … --force` 覆盖上传。
- secrets/vars 沿用 Spherse 命名：`OSS_BUCKET` / `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` / `OSS_PUBLIC_BASE_URL`（在新仓库配置同名）。

### 语义约定

- **内容变更必须 bump version**：diff 基于 version；版本没变的内容变更不会发布（README 写明）。
- **下架 = 从仓库删目录**：下次发布 manifest 自然不含该条目；OSS 旧 zip 保留作不可变历史。
- **首次发布**：OSS manifest 404 → 全量发布所有技能。

## 错误处理与安全

### 体验侧

| 场景 | 行为 |
|---|---|
| manifest 拉取失败（网络/OSS 故障） | Dialog 错误态 + 重试按钮 |
| 安装时 manifest 已更新（version 不匹配） | 409；Dialog 提示并自动 refetch 刷新卡片 |
| zip 下载/校验失败（无 SKILL.md、name 不符、路径逃逸） | 沿用 `installSkill` 现有错误；卡片 error + 重试；覆盖失败时旧目录保持不动（可回滚） |
| 本地同名手动技能（无 version） | 不显示「更新」，避免误覆盖手动创作的技能；显式安装同名时按钮为已安装禁用态 |

### 安全要点

- **SSRF 防线**：renderer 只能传 `{ name, version }`；zipUrl 由 server 从 manifest 解析，下载前校验 host === manifest host；renderer 永远无法传任意 URL。
- **zip 内容校验**：完全复用 `installSkill` 已有逻辑（entry 路径逃逸检查、单一顶层目录、frontmatter 一致性）。
- **技能即提示词注入载体**：市场条目仅展示来自发布仓库 git 管理的 name/description（受控源），Dialog 底部保留一行说明文案。

### 发布侧

- 校验失败 → 脚本非零退出，pipeline 红，不产生部分上传。
- zip 上传失败 → pipeline 失败；版本化路径 + `--force` 天然幂等可重跑；manifest 最后上传，失败则市场不可见新版本，重跑即可。

## 测试策略

- **core 单测**（扩展 `__tests__/store/skill.test.ts`）：`installSkill` 覆盖模式（成功替换、失败回滚、非 overwrite 冲突仍抛错）、`version` frontmatter 解析。
- **server 契约测试**（`__tests__/contracts/api-contracts.test.ts` 模式）：marketplace contracts schema；manifest 代理与安装 route 用 mock fetch 测（409 竞态、404、SSRF host 校验、成功/失败路径）；含**不 mock 被测门面方法**的 `installSkill` 契约测试（真 ProjectManager 落盘）。
- **app 单测**：semver compare util、卡片状态推导（本地 version 组合矩阵）、MarketplaceDialog 渲染态。
- **E2E**（packages/desktop）：市场 Dialog 打开 → 卡片展示 → 安装 → 技能出现在 skill panel；manifest URL 常量支持环境变量注入覆盖，E2E 起 stub server 提供测试 manifest 与 zip。
- **发布侧**：publish-skills.mjs 本地 dry-run 单测（tmp 目录模拟 `skills/` + mock 旧 manifest，校验 diff 逻辑与 zip 结构）；真实 OSS 上传手动触发验证。

## 交付物清单

1. `packages/core`：`installSkill` overwrite 选项 + `SkillDefinition.version` 解析（含单测）
2. `packages/server`：`contracts/marketplace.ts` + 2 个新 route + manifest 常量/缓存（含契约测试）
3. `packages/app`：菜单入口 + `MarketplaceDialog` + `useProjectSkills` + semver util（含单测）+ i18n 三语言文案
4. `spherse-assets` 新仓库骨架：目录结构 + `publish-skills.mjs` + `publish.yml` + README（含脚本 dry-run 测试）
5. 文档同步：`docs/official/`（如 skills 相关文档需补市场章节）、`docs/dev/backlog.md` 条目
