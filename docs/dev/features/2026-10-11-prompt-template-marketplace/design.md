# 预制提示词模板市场（Prompt Template Marketplace）设计

## 背景与目标

Agent dialog 中的预制模板目前是 `@spherse/presets` 构建期常量（`PRESET_PROMPT_TEMPLATES`），UI 为提示词 Textarea 下方的 badge 行，点击后将模板内容**自动替换**进 systemPrompt（非空时弹确认）。该渠道的问题是：模板内容随客户端发版更新、无法运营扩展、无法承载更多模板。

本次改为：点击入口弹出一个独立的模板市场 Dialog，内容来自 aliyun OSS（与技能市场/项目市场同机制，源文件在外部仓库 spherse-assets 管理）。用户可一键复制某模板，或进入详情视图完整浏览。**移除现有的构建期渠道与自动替换体验**。

## 已确认的决策（与用户澄清）

| 决策点 | 结论 |
|---|---|
| 语言回退粒度 | **仅整包回退**：每个语言的大 JSON 只包含拥有该语言版本的模板；仅当请求的语言 JSON 整体不存在（404）时回退。缺当前语言的模板在该语言下不显示 |
| meta 文件 | **分语言**（`meta.zh-cn.json` / `meta.en-us.json` 并存），标题/简介/类别本地化；meta 回退链与内容回退链**同构**：zh 系语言 `当前语言 → zh-cn → en-us`，其余 `当前语言 → en-us → zh-cn`（保证 zh-TW 包内不会出现「简体正文 + 英文标题」的矛盾组合） |
| zh-TW 回退 | **直接回退 zh-cn**（繁体用户读简体优于读英文；与 app 默认语言为 zh-CN 的方向一致。注意 app 自身 i18n 并无按条目回退，此处仅为类比） |
| 详情交互 | dialog 内切换详情视图：卡片网格 + 「查看」进入详情页（全文 + 复制 + 返回） |
| spherse-assets 侧 | 本次在本地 `~/workspace/spherse-assets` 一并实现（prompts/ 结构、publish 脚本、workflow、迁移现有 2 个模板并起草 en-us 翻译） |

## 总览架构

```
spherse-assets（外部仓库）                         Spherse 主仓库
┌─────────────────────────────┐
│ prompts/{id}/                │   GitHub Actions (publish.yml)
│   meta.{lang}.json           │ ──publish-prompts.mjs──▶ dist/spherse/prompts/{lang}.json
│   {lang}.md                  │                              │ ossutil 上传
└─────────────────────────────┘                              ▼
                                              aliyun OSS: spherse/prompts/{lang}.json
                                                             │
                                              Fastify server（代理 + 回退链 + 缓存）
                                                GET /api/marketplace/prompts?language=zh-cn
                                                             │
                                              renderer（TanStack Query + Dialog）
                                                agent dialog 入口按钮 → PromptTemplatesDialog
```

- renderer 不直接请求 OSS（与 skills/projects 市场一致，SSRF/大小/超时防线在 server）
- 打开 dialog 时一次性加载当前语言的大 JSON（全量模板内容内联，无 zip、无安装步骤）

## OSS 布局与 JSON 格式

OSS 路径：`spherse/prompts/{lang}.json`（如 `zh-cn.json`、`en-us.json`），每个语言一个大 JSON：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-11T00:00:00.000Z",
  "language": "zh-cn",
  "prompts": [
    { "id": "worldview-assistant", "title": "世界观创作助手", "description": "…", "category": "创作", "content": "…" }
  ]
}
```

- `{lang}.json` 只包含拥有 `{lang}.md` 的模板（整包回退语义）
- 每次发布全量重新生成所有语言 JSON 并覆盖上传，无版本化、无远端 diff（无安装/增量语义，不需要）

## spherse-assets 源格式

每个模板一个目录：`prompts/{prompt-id}/`：

```
prompts/worldview-assistant/
  meta.zh-cn.json     # { "title": "…", "description": "…", "category": "…" }
  meta.en-us.json
  zh-cn.md            # 提示词正文
  en-us.md
```

校验规则（build 时强制）：

- `prompt-id` 与 skills/projects 的 name 规则一致（不含 `/ \ :`、不以 `.` 开头）
- 语言码格式 `^[a-z]{2}(-[a-z]{2})?$`
- 每个模板目录：至少一个 `{lang}.md` 且至少一个 `meta.{lang}.json`，否则报错
- meta 的 `title` / `description` / `category` 必填非空
- meta 允许条目级回退：构建 `{lang}.json` 时，某模板的 meta 取 `meta.{lang}.json`，缺失则沿与内容回退链同构的链解析（zh 系：`L → zh-cn → en-us`；其余：`L → en-us → zh-cn`）；**链耗尽（该模板没有任何链内 meta 文件）→ build 报错退出**。内容文件的入选由 `{lang}.md` 是否存在决定，meta 不影响入选
- 只有 `meta.zh-cn.json` / `meta.en-us.json`（及各包自身语言的 meta）会被消费；无对应 `{lang}.md` 的其它语言 meta（如孤儿 `meta.ja-jp.json`）不会被任何包用到，也不影响校验
- `prompts/` 下没有任何有效模板时报错退出（全量下架 = 手动删除 OSS 对象，不做空发布）

### publish-prompts.mjs 流程

镜像 `publish-projects.mjs` 的结构（scan → 校验 → 生成 dist），差异：

- 无 zip、无 `OSS_PUBLIC_BASE_URL` 依赖（JSON 内容全内联，不构造 URL）、无远端 manifest fetch、无 diff
- 产出：语言集合 = 全部内容文件语言的并集；对每个语言 L 生成 `dist/spherse/prompts/L.json`
- 单测 `publish-prompts.test.mjs` 纳入 `npm test`

### publish.yml 改动

- `inputs.resource` 增加 `prompts` 选项
- build step：`node scripts/publish-prompts.mjs`
- **「Install ossutil」step 的 `if` 条件追加 `|| inputs.resource == 'prompts'`**
- upload step：`find dist/spherse/prompts -name '*.json'` 逐个 `ossutil cp --force -u`（各语言 JSON 相互独立，无「manifest 最后上传」约束）

## 体验侧设计

### contracts（packages/contracts）

新文件 `src/prompt-marketplace.ts`：

- `marketplacePromptEntry`：`{ id, title, description, category, content }`（全 String）
- `marketplacePromptManifestResponse`：`{ schemaVersion: Number, generatedAt: String, language: String, prompts: Array<marketplacePromptEntry> }`
- 经 `index.ts` 汇出 schemas + 派生类型（镜像契约面全集导出规则）

### server（packages/server）

新文件 `src/prompt-marketplace.ts`（service）：

- `PROMPTS_BASE_URL = process.env.SPHERSE_PROMPT_MARKETPLACE_BASE_URL ?? \`${OSS_BUCKET_BASE_URL}/prompts\``（env 覆盖用于测试/E2E stub）
- `createPromptMarketplaceService({ fetchFn?, baseUrl?, cacheTtlMs? })` → `getPrompts(language)`
- **回退链**（server 端一处实现，链内去重；裸 `zh` 视为 zh 系）：
  - `zh-cn` → `[zh-cn, en-us]`
  - 其它 zh 系（`zh-tw`、裸 `zh` 等）→ `[L, zh-cn, en-us]`
  - 其余（如 `en-us`、未来的 `ja-jp`）→ `[L, en-us, zh-cn]`（en-us 为缺省默认，zh-cn 兜底）
- 逐个 fetch `${base}/${lang}.json`：404 → 试下一个；其它非 2xx / 网络错误 / 超时 / 超限 → 直接 502（不掩盖真实错误）；整链 404 → 404
- 30s 内存缓存（按请求语言 key，回退解析结果随请求语言缓存）+ in-flight 去重；**404 不进缓存**（缺失语言期间每次打开 dialog 会重新打一次上游 404，量级无害，接受；不做负缓存）
- 超时 10s、`redirect: "error"`、UA、content-length 预检 + 5MB 上限、**无 content-length 时流式累计校验**（复用 marketplace.ts 的既有模式）
- 单例 `promptMarketplaceService` 导出

新文件 `src/routes/prompt-marketplace.ts`：

- `GET /api/marketplace/prompts?language=zh-cn`（**全局路由**，不挂 projectId —— 提示词与项目无关）
- `language` 校验 `^[a-z]{2}(-[a-z]{2})?$`，非法 → 400
- 响应 200（contract schema）/ 404（整链不存在）/ 502（上游故障）
- 注册进 `routes/index.ts`

### app（packages/app）

**新增** `queries/marketplace-prompts.ts`：

- `promptLanguageFromLocale(locale: Locale): string`：`zh-CN → "zh-cn"`、`zh-TW → "zh-tw"`、`en → "en-us"`（locale → 资产语言码的映射留在 renderer，server 不感知 app locale）
- `useMarketplacePrompts(client: GlobalApiClient, language, enabled)`：`staleTime: 0`，key `["marketplace", "prompts", language]`
- `invalidateMarketplacePromptQueries(language)`

**GlobalApiClient**（`lib/api.ts`）新增 `listMarketplacePrompts(language)` → `GET /api/marketplace/prompts?language=…`（响应过 `parseContract`）。

**新增** `features/agent-dialog/PromptTemplatesDialog.tsx`：

- `useI18n()` 取 locale → language；`useGlobalApiClient()` 取 client（null 时走错误态；偏离 `{client && …}` 父级守卫先例的原因：dialog 需常挂载以保留 Radix 开关动画，与 AgentDialogForm 内既有 AlertDialog 常挂载模式一致）
- **常挂载**（`open` prop 控制，镜像两个市场 dialog），因此 `AgentDialogForm.test.tsx` 的 `vi.mock("../../lib/use-connection")` 需补 `useGlobalApiClient` stub（当前只导出 `useApiClient`，不补会直接崩溃）
- 打开时 invalidate + 拉取（镜像 MarketplaceDialog 的 `enabled: open` 模式）
- 列表视图：分类 chips（`deriveCategories`/`filterByCategory` 泛化为 `{ category: string }` 并**上提到 `packages/app/src/lib/categories.ts`**——跨 feature 复用走 lib 层，`features/project-market/categories.ts` 与其测试随之迁移）+ 卡片网格（1/2 列）：title、category badge、description（line-clamp-2）、「查看」「复制」按钮
- 详情视图：选中模板 id 的本地 state 切换；标题 + category badge + 全文（`whitespace-pre-wrap font-mono` 可滚动区域，纯文本忠实原文）+「复制」「返回」
- 复制：`navigator.clipboard.writeText`，按钮 label/图标翻转（复制 → 已复制，CopyIcon → CheckIcon，约 2s 复位，参照 CodeBlock 模式）
- loading / error+重试 / empty 三分支，文案镜像两个市场 dialog；**API 404（整链无 JSON，市场未发布/全下架）映射为 empty 态而非 error 态**（重试无意义，通过 `err instanceof ApiError && err.status === 404` 区分）
- 嵌套于 AgentDialog（Radix portal，与现有 AlertDialog 嵌套同机制）

**入口（AgentDialogForm）**：Textarea 下方的 badge 行替换为 `预设模板：[浏览模板…]` 单按钮（位置不变），点击 `setTemplatesOpen(true)`；删除 `PromptTemplatePicker`、`handleSelectTemplate`、`applyTemplate`、确认 AlertDialog。

**移除清单**：

| 位置 | 动作 |
|---|---|
| `packages/presets/presets.json` | 删 `presetPromptTemplates` |
| `packages/presets/templates/prompt-templates/` | 删除（内容迁移至 spherse-assets） |
| `packages/presets/scripts/sync-templates.mjs` | 删 prompt-templates 生成块 |
| `packages/presets/src/generated/prompt-templates.ts` | 不再生成（gitignored，本地删除） |
| `packages/presets/src/index.ts` | 删 `PRESET_PROMPT_TEMPLATES` 导出 |
| `packages/presets/__tests__/sync-templates.test.ts` | 删对应断言块 |
| `packages/app/src/features/agent-dialog/PromptTemplatePicker.tsx` | 删除 |
| i18n keys | 删 `agent-dialog.templateLabel`、`agent-dialog.template.{worldview-assistant,roleplay}`、`agent-dialog.templateConfirm*`；保留复用 `agent-dialog.templatePresetsLabel` 作为入口行前缀 |

**新增 i18n keys**（`agent-dialog.templates.*`，三语言同步）：`browse`（入口按钮）、`title`、`copy`、`copied`、`view`、`back`、`loading`、`loadFailed`、`retry`、`empty`、`categoryAll`。

## 错误处理与安全

- renderer 永远只调本地 API，language 参数仅作语言码（服务端构造 URL，无用户可控 URL → 无 SSRF 面）
- 上游 5xx / 非 JSON / 契约不合法 / 超时 / 超大小 → 统一 502；整链 404 → 404（客户端展示 loadFailed/empty 区分）
- 复制失败静默降级（与 CodeBlock 一致，clipboard 不可用时按钮无反馈）

## 测试策略

| 层 | 文件 | 覆盖 |
|---|---|---|
| spherse-assets | `scripts/publish-prompts.test.mjs` | scan 校验矩阵（缺内容/缺 meta/非法语言码/非法 id）、语言并集、按语言入选、meta 回退链、空目录报错、JSON 结构 |
| contracts | `api-contracts.test.ts` 追加 | prompt manifest schema 合法/非法样例 |
| server | `__tests__/prompt-marketplace-routes.test.ts` | stub OSS server：200、400（language 非法）、回退链（请求 zh-tw 且 zh-tw.json 404 → zh-cn.json 200；请求 en-us 且 en-us.json 404 → zh-cn.json 200）、整链 404 → 404、上游 500 → 502、缓存 TTL、schema 不合法 → 502 |
| app | `queries/marketplace-prompts.test.ts` | promptLanguageFromLocale 矩阵、query key/enabled/staleTime 0 |
| app | `lib/categories.test.ts` | 从 project-market 迁移，泛化后既有用例不回归 |
| app | `AgentDialogForm.test.tsx` | use-connection mock 补 `useGlobalApiClient` stub |
| desktop E2E | `e2e/prompts-marketplace.spec.ts` | stub marketplace server + `SPHERSE_PROMPT_MARKETPLACE_BASE_URL` 注入：打开 agent dialog → 入口 → 卡片 → 复制 → 详情 → 返回（镜像 project-marketplace.spec.ts） |

PromptTemplatesDialog 组件测试不补（对齐 2026-08-29 react-component-testing 设计中「市场 dialog 不补」的决策）。

## 交付物清单

**主仓库**：

- [ ] `packages/contracts/src/prompt-marketplace.ts` + index 导出 + 契约测试
- [ ] `packages/server/src/prompt-marketplace.ts`（service + 回退链 + 缓存）
- [ ] `packages/server/src/routes/prompt-marketplace.ts` + 注册 + 路由测试
- [ ] `packages/app`：queries、GlobalApiClient 方法、PromptTemplatesDialog、AgentDialogForm 入口改造、AgentDialogForm.test.tsx mock 更新
- [ ] `packages/app`：categories 辅助函数泛化并上提至 `lib/categories.ts`
- [ ] `packages/presets`：移除 prompt template 渠道（presets.json / sync-templates / index / 测试 / README）
- [ ] i18n 三语言 key 增删（加载 i18n skill）
- [ ] desktop E2E spec
- [ ] 文档同步（project-structure / data-conventions / **architecture/server.md**（routes 表 + service 单例描述）/ **architecture/frontend.md**（`staleTime: 0` 域清单）/ **architecture/index.md**（presets 描述）/ contracts README / server README / presets README）

**spherse-assets（本地 ~/workspace/spherse-assets，不自动 commit）**：

- [ ] `prompts/worldview-assistant/`（zh-cn.md 迁移、en-us.md 起草、双语言 meta）
- [ ] `prompts/roleplay/`（同上）
- [ ] `scripts/publish-prompts.mjs` + 单测、package.json scripts、workflow 增加 prompts、README

## Review 记录（2026-10-11 sub agent review）

无 critical。已处理：

- I-1 常挂载 dialog 需更新 `AgentDialogForm.test.tsx` 的 use-connection mock → 已列入交付物
- I-2 zh-TW 内容链与 meta 链组合矛盾 → meta 回退链改为与内容回退链同构（zh 系 `L → zh-cn → en-us`），已在决策表记录
- I-3 文档同步遗漏 architecture 域文件（server.md / frontend.md / index.md）→ 已列入交付清单
- M-1 整链 404 客户端映射 → 明确为 empty 态
- M-2 meta 链耗尽 → 明确 build 报错退出
- M-3 publish.yml 「Install ossutil」step 条件 → 已补
- m-1 孤儿 meta 表述修正；m-2 zh-TW 类比措辞修正；m-3 categories 上提 `lib/categories.ts`；m-4 测试用例措辞修正 + 链内去重注明；m-5 404 不缓存注明接受；m-6 无 content-length 时流式累计校验已补

## Code review 记录（2026-10-11 实现后 sub agent review）

无 critical / important。已修复：

- M-1 OSS bucket base URL 双处硬编码 → `marketplace.ts` 导出 `OSS_BUCKET_BASE_URL`，`PROMPTS_BASE_URL` 恢复模板表达式
- m-1 client null 时 dialog 停留 loading → 改为渲染 loadFailed 态（client 恢复后自愈）
- m-2 裸 `zh` 回退链语义 → server 与 spherse-assets 两侧均归入 zh 系（`[zh, zh-cn, en-us]`），回退链规格同步更新

记录未修：

- m-3 spherse-assets 工作区混有无关 untracked 文件 → 该仓库提交时逐文件显式 add
- m-4 contracts README 经检查无需改动（不含逐 schema 文件清单，同名文件对应规则已满足）

备注：E2E `prompts-marketplace.spec.ts` 已实跑通过；OSS 发布需先在 spherse-assets 提交并手动触发 publish workflow（resource = prompts），发布前线上 dialog 将命中整链 404 → 空态。
