# Agent 参考资料格式与总大小限制

- **Date**: 2026-08-30
- **Status**: Design
- **Backlog**: 新增 `[ ] 限制 agent 参考资料为纯文本文件、总大小 ≤ 512kB`

## 1. 背景与动机

Agent 创建/编辑 dialog 允许为 agent 配置「参考资料」（frontmatter `context: string[]`，项目内相对路径）。session 启动时 `readContextFiles`（`packages/core/src/session/read-context-files.ts`）把这些文件全量读入并注入 system prompt 的 `<preloaded-context>` 块。

当前没有任何限制：

- **格式不限**：可以添加图片、PDF、SQLite 等二进制文件。二进制内容以 utf-8 读入后产生乱码，污染 system prompt、浪费 token，严重时挤压上下文窗口。
- **总大小不限**：可以添加任意多的大文件，直接撑爆 system prompt。

本特性对参考资料加两条硬限制：

1. **只允许纯文本文件**（扩展名 allowlist + 知名无扩展名文件名集合）
2. **所有参考资料总大小 ≤ 512 kB**（512 × 1024 = 524288 字节，按磁盘文件 stat size 计）

## 2. 现状梳理

### 2.1 context 的三条写路径

| 路径 | 链路 | 是否可校验 |
|---|---|---|
| UI 表单 | AgentDialog → `POST /agents/create` / `PUT /agents/:id` → `ProjectStore.createAgent/updateAgent` | ✅ 汇入 core 漏斗 |
| `manage_agent` 工具 | agent 通过工具建/改 agent → 同样汇入 `ProjectStore.createAgent/updateAgent` | ✅ 同一漏斗 |
| 手改磁盘 | 用户直接编辑 `.spherse/agents/<dir>/profile.md`。agent profile **不在 fs-watcher 监听范围**（`WATCHED_CATEGORIES` 无 `agentProfile` 类目），改动不热加载，重启/重开项目后经 `loadAgents` 读入 | ❌ 不经过任何代码 |

`initPresets`（项目初始化种入 agent）也汇入 `createAgent`，且 `PRESET_AGENTS` / `AGENT_TEMPLATE` 均不含 `context` 字段，不会触犯限制。

### 2.2 消费路径

每次 session 启动 `buildAgent` → `readContextFiles(projectRoot, profile.context, policy)`：逐个 resolve（路径安全）、policy canRead 检查、读全文。missing / traversal / blocked 文件静默跳过，无格式与大小检查。

### 2.3 关键约束

- file-tree API 只返回路径数组，不带 size；前端目前没有任何途径拿到文件大小。
- 依赖方向：`contracts → core → presets`；app renderer 只从 presets/contracts/i18n/sdk 做运行时值导入，从 core 只做 type import（core 含 better-sqlite3/pino 等 Node 依赖，不可进 renderer bundle）。
- 因此**共享常量（allowlist + 上限）必须放 presets**：core 与 app 都能运行时引用，单一来源。

## 3. 方案总览：三层防线

| 层 | 位置 | 时机 | 行为 |
|---|---|---|---|
| L1 添加时（UX） | app `ContextPathField` / `SearchFileField` | 用户添加文件 | 格式不符 / 超预算 → toast 报错，不加入 |
| L2 保存时（权威写门） | core `ProjectStore.createAgent/updateAgent` | agent 创建/更新 | 扩展名检查 + stat 总大小检查，违规抛 `ValidationError`（覆盖 UI 与 `manage_agent` 两条写路径） |
| L3 组装时（运行时兜底） | core `readContextFiles` | session 启动 | 跳过非文本扩展名文件；stat 后按声明顺序贪心装填，超出预算的跳过 + warn log |

L3 存在的理由：文件在加入后内容可能增长（保存时合规、组装时超限）；手改 frontmatter 的配置在重启/重开项目后读入，完全绕过 L2。只有消费点能守住「注入总量恒 ≤ 512 kB」的不变量。

超限挤出的文件**静默跳过 + warn log**（与现有 missing/blocked 跳过行为一致），不在 prompt 内留标记。

## 4. 架构设计

### 4.1 presets：共享策略常量（单一来源）

`packages/presets/src/context-file-policy.ts` 新增：

```ts
export const CONTEXT_TOTAL_SIZE_LIMIT_BYTES = 512 * 1024;

export const TEXT_FILE_EXTENSIONS: ReadonlySet<string>;  // 小写、不含点
export const TEXT_FILE_BASENAMES: ReadonlySet<string>;   // 小写、知名无扩展名文件

export function isTextContextPath(relPath: string): boolean;
```

- `isTextContextPath`：basename 命中 `TEXT_FILE_BASENAMES`（大小写不敏感）、或以 `.env` 为前缀的 dotfile 家族（`.env`、`.env.local`、`.env.production` 等，`path.extname` 对它们返回 `.local`/`.production` 之类无法穷举的后缀）、或扩展名命中 `TEXT_FILE_EXTENSIONS`（大小写不敏感；`.gitignore` 这类 dotfile 的 extname 为空，走 basename 集合）。
- 初始扩展名集合（分组合并成一个 Set，随版本演进扩充）：
  - 文档：`txt text md markdown mdx rst adoc org`
  - 数据/配置：`json jsonc json5 yaml yml toml csv tsv xml html htm xhtml ini cfg conf config properties env plist sql graphql gql proto lock log`
  - Web/脚本：`css scss sass less js mjs cjs ts tsx jsx vue svelte astro`
  - 编程语言：`py pyi rb go rs java kt kts swift c h cpp cc cxx hpp hh cs php dart lua pl r jl scala m mm sh bash zsh fish ps1 psm1 bat cmd vim el lisp clj cljs edn ex exs erl hrl hs ml mli fs fsx nim zig v d groovy gradle tf hcl diff patch`
- 初始 basename 集合：`makefile dockerfile license licence notice readme procfile jenkinsfile vagrantfile gemfile rakefile .gitignore .gitattributes .dockerignore .editorconfig`（`.env` 家族由前缀规则覆盖）
- 纯数据 + 纯函数，无 fs 依赖，browser-safe；从 `packages/presets/src/index.ts` 导出。

### 4.2 contracts：inspect 端点契约

`packages/contracts/src/context-files.ts` 新增：

```ts
contextFilesInspectRequest:  Type.Object({ paths: Type.Array(Type.String(), { maxItems: 1000 }) })
contextFilesInspectResponse: Type.Object({
  files: Type.Array(Type.Object({
    path: Type.String(),        // 与请求 1:1
    exists: Type.Boolean(),     // 解析成功且 stat 到普通文件
    sizeBytes: Type.Integer(),  // 不存在为 0
    allowed: Type.Boolean(),    // isTextContextPath 结果
  })),
})
```

`allowed` 与判定逻辑由服务端计算返回，前端不重复实现判定（建议列表过滤除外，见 4.5——那里用的是 presets 的 `isTextContextPath`，同一来源）。inspect 只服务 dialog 交互流程（当前路径 + 候选，数量小）；`maxItems` 仅防御恶意请求，超长手改配置由 L2/L3 兜底。重复路径在 L2 求和与 L3 贪心装填中均重复计数（一致语义）。

### 4.3 server：inspect 路由

`packages/server/src/routes/context-files.ts` 新增 `POST /api/projects/:projectId/context-files/inspect`：

- body/response 走 4.2 schema
- handler 调 core 的 `inspectContextFiles(projectRoot, paths)`（见 4.4）
- 选择 POST：paths 是批量数组，放 URL query 有长度与编码问题

### 4.4 core：校验与兜底

#### `packages/core/src/session/context-file-policy.ts`（新）

```ts
export interface ContextFileStat { path: string; exists: boolean; sizeBytes: number; allowed: boolean }

export async function inspectContextFiles(projectRoot, paths): Promise<ContextFileStat[]>;
// resolveProjectPath 逐个安全解析；traversal / 不存在 / 非普通文件 → { exists: false, sizeBytes: 0 }
// allowed 来自 presets 的 isTextContextPath

export async function assertContextFilesWithinPolicy(projectRoot, context: unknown): Promise<void>;
// context 非 string[] 时跳过（保持现状，不新增严格性）；否则：
//   1) allowed=false 的路径 → 收集
//   2) stat 现存文件，sum(sizeBytes) > LIMIT → 收集（missing 文件计 0，不阻断——与组装时跳过 missing 的现状一致）
//   违规 → 抛 ValidationError，message 列出违规路径与各文件大小
```

#### `ProjectStore.createAgent / updateAgent`（改）

两个方法在写入前调 `assertContextFilesWithinPolicy(this.rootPath, matter(content).data.context)`。这是 UI 路由与 `manage_agent` 工具的公共漏斗，一处校验覆盖两条写路径。

#### `readContextFiles`（改）

在现有 resolve → policy 检查之后、读文件之前插入：

```ts
if (!isTextContextPath(relPath)) { logger?.warn(...); continue; }
const size = (await fs.stat(resolved)).size;      // stat 不到 → continue（维持现有跳过语义）
if (usedBytes + size > CONTEXT_TOTAL_SIZE_LIMIT_BYTES) { logger?.warn(...); continue; }
// readFile 后 usedBytes += size
```

- 预算按**声明顺序贪心装填**：装得下就装，装不下跳过该文件继续看下一个（小的文件仍可能装下）。
- 新增可选 `logger` 参数；调用点 `agent-assembly.ts` 传 `deps.logger`（现有测试传 3 参不受影响）。

#### `manage_agent` 工具（改）

`context` 参数的 description 补充约束说明（仅纯文本文件、总量 ≤ 512 kB），让 LLM 提前知道边界；违规时 `ValidationError` → 现有 `fail()` 路径返回错误信息。

### 4.5 app：添加时校验与用量展示

`packages/app/src/lib/api.ts` 新增 `inspectContextFiles(paths)`。`ContextPathField` 改造：

1. **建议列表过滤**：`SearchFileField` 新增可选 `filter?: (path: string) => boolean` prop（保持组件通用），`ContextPathField` 传入 `isTextContextPath`（import 自 presets），在现有 `FILE_TREE_EXCLUDE` 过滤之后生效。
2. **添加校验**（选中建议或手动 Enter 都走同一路径）：
   - 格式：client 端 `isTextContextPath` 不通过 → toast `refsFormatError`，不加入
   - 大小：调 `inspectContextFiles([...contextPaths, candidate])`，现存文件 sizeBytes 求和 + candidate 超过 `CONTEXT_TOTAL_SIZE_LIMIT_BYTES` → toast `refsSizeError`，不加入；通过 → `onAdd(path)`
3. **用量展示**：对当前 `contextPaths` 发 inspect 请求（react-query，key 含 paths），在搜索框下方显示 `已用 X kB / 512 kB`（muted 小字）；超限时变 destructive 色。badge 本体仍显示路径，`title` tooltip 显示单文件大小（`path · 12.3 kB`）。
   - edit 模式打开已有超限配置（文件事后增长）时：用量行变红提示，保存时被 L2 以明确报错阻断。

### 4.6 不改动

- file-tree 契约与端点（不加 size，避免影响所有消费方）
- `preloaded-context` 渲染格式（不留 skipped 标记）
- `AgentProfile` 类型、`agentCreateRequest/UpdateRequest` wire schema（context 仍在 markdown content 内）
- access policy 语义（blocked 文件沿用组装期静默跳过，inspect 不做 policy 判断——size 是无害元数据，且 blocked 文件加入后本就被跳过，属于用户操作问题，不在本特性范围）

## 5. 数据流

```
添加文件（UI）
  SearchFileField 建议列表 ← isTextContextPath 过滤（presets 常量）
  选中/Enter → inspectContextFiles(current + candidate)（POST → core inspect）
    ├─ 格式不符 → toast，终止
    ├─ Σ size + candidate > 512kB → toast，终止
    └─ 通过 → formData.context 更新 → 用量行刷新

保存（L2）
  UI / manage_agent → ProjectStore.createAgent/updateAgent
    → assertContextFilesWithinPolicy（扩展名 + stat 总量）
    → 违规 ValidationError → UI 错误区 / 工具 fail() 消息

组装（L3）
  buildAgent → readContextFiles
    → 非文本扩展名跳过；stat 贪心装填 ≤ 512kB；越界跳过 + warn log
```

## 6. i18n

新增 key（三语言，zh-CN 带注释）：

| Key | zh-CN | en | zh-TW |
|---|---|---|---|
| `agent-dialog.refsFormatError` | 不支持的文件格式：仅允许纯文本文件 | Unsupported file format: only plain-text files are allowed | 不支援的檔案格式：僅允許純文字檔案 |
| `agent-dialog.refsSizeError` | 参考资料总大小不能超过 512 kB | Reference files total size cannot exceed 512 kB | 參考資料總大小不能超過 512 kB |
| `agent-dialog.refsUsage` | 已用 {used} / 512 kB | {used} / 512 kB used | 已用 {used} / 512 kB |

实现时加载 i18n skill 按其流程操作。

## 7. 错误处理

| 场景 | 行为 |
|---|---|
| 添加二进制/未知扩展名文件 | L1 toast 格式错误；即使绕过（手改），L2 保存报错、L3 组装跳过 |
| 添加后文件总大小超限 | L1 toast 大小错误；L2 保存报错（列各文件大小） |
| 保存后文件增长超限 | L3 贪心装填，越界文件跳过 + warn log，注入总量恒 ≤ 512kB |
| 手改 frontmatter 塞入超限/非文本 | 同上，L3 兜底 |
| inspect 请求失败 | toast 请求错误（复用现有错误展示），添加流程终止 |
| missing 文件 | 沿用现状：L2 计 0 不阻断，L3 静默跳过 |

## 8. 测试覆盖

不变量密集，按 TDD 先写测试：

- **presets**：`isTextContextPath` 单测（各扩展名分组、大小写不敏感、dotfile、Makefile/LICENSE 等 basename、无扩展名未知文件拒绝）
- **core**：
  - `inspectContextFiles`：exists/size/allowed、traversal、missing、非普通文件
  - `assertContextFilesWithinPolicy`：非文本拒绝、超限拒绝（message 含路径与大小）、恰好等于 512kB 通过、missing 计 0 通过、非 string[] 跳过
  - `ProjectStore.createAgent/updateAgent`：违规 context 抛 ValidationError（两条写路径契约测试）
  - `readContextFiles`：跳过非文本扩展名；贪心装填顺序语义（大文件跳过后小文件仍可装入）；总量恰好在边界通过；warn log 调用
- **contracts**：inspect request/response schema parse 测试
- **server**：
  - inspect 路由 happy path + traversal path 返回 exists:false
  - 契约测试（不 mock 被测门面）：create/update 携带违规 context → 400 + 错误信息，走真实 `ProjectStore`（仓库红线：PM 写入门面消费方至少各一条契约测试）
- **app**：`ContextPathField` 添加校验（格式 toast / 超限 toast / 通过 onAdd）、用量行渲染与超限变色、`SearchFileField` 建议过滤

## 9. 影响面

### 9.1 代码改动清单

| 文件 | 改动 |
|---|---|
| `packages/presets/src/context-file-policy.ts` | 新增：常量 + `isTextContextPath` |
| `packages/presets/src/index.ts` | 导出 |
| `packages/contracts/src/context-files.ts` | 新增：inspect schemas |
| `packages/contracts/src/index.ts` | 导出 |
| `packages/server/src/routes/context-files.ts` | 新增：POST inspect 路由 |
| `packages/server/src/routes/index.ts` | 注册 |
| `packages/core/src/session/context-file-policy.ts` | 新增：`inspectContextFiles` / `assertContextFilesWithinPolicy` |
| `packages/core/src/session/read-context-files.ts` | L3 兜底 + logger 参数 |
| `packages/core/src/session/agent-assembly.ts` | 传 logger |
| `packages/core/src/store/project.ts` | create/update 接入 L2 |
| `packages/core/src/tools/manage-agent.ts` | context 参数 description 补约束 |
| `packages/core/src/index.ts` | 导出（server 需要的 inspect + presets 复用项不重复导出） |
| `packages/app/src/lib/api.ts` | `inspectContextFiles` 方法 |
| `packages/app/src/features/agent-dialog/ContextPathField.tsx` | 添加校验 + 用量行 + tooltip |
| `packages/app/src/features/agent-dialog/SearchFileField.tsx` | 建议过滤 |
| `packages/i18n/src/locales/{zh-CN,en,zh-TW}.ts` | 新 key |

### 9.2 文档同步（doc-sync 时执行）

- `docs/official/data-conventions.md`：agent frontmatter `context` 字段约束（纯文本 + 512kB）
- `docs/official/architecture/` 对应域文件（session/agent 装配处提及参考资料限制）
- `packages/presets/README.md`：新增共享策略常量说明
- `docs/official/project-structure.md`：如有新文件条目需登记
- `docs/dev/backlog.md`：完成后删除条目

## 10. 非目标

- 不做文本内容嗅探（如 NUL 字节检测）：扩展名 allowlist 已覆盖绝大多数场景，改名伪装的二进制属于恶意边缘案例，组装期 utf-8 乱码对上下文的伤害受 512kB 总量硬上限约束
- 不改 file-tree 契约
- 不追溯清理存量违规配置：L3 保证运行时不越界，用户下次编辑保存时被 L2 阻断并得到明确报错
- 不在 prompt 内渲染 skipped 标记
