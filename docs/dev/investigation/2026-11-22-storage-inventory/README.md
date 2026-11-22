# 存储面盘点：browser 版存储端口抽象前置调研

- 日期：2026-11-22
- 状态：完成（纯代码盘点，未改任何代码）
- 分支：`dev-v2`
- 关联设计：`docs/dev/infra/2026-11-21-plugin-runtime-rpc/design.md`（D2/D3 store 插件、D5 SharedWorker、D6 上传分形态）；`docs/dev/investigation/2026-11-22-browser-matrix/README.md`（OPFS sync handle 独占锁、单写者强制实测）
- 目的：为 SessionStore / EventStore / ContentStore 等端口划分提供事实基础。所有结论均给出 `file:line` 证据（路径相对仓库根，省略 `packages/` 前缀时以实际路径为准）。

## 0. 总览表

| # | 存储面 | 位置 / 形态 | owner（core 内） | 主要消费方 | 一致性要点 | browser 评估（结论） |
|---|---|---|---|---|---|---|
| 1 | sessions.db | `.spherse/agents/{slug}/sessions.db`（SQLite WAL，per-agent） | `store/session.ts` SessionStore + `session/event-log.ts` | REST sessions 路由、RPC sessions/chat 方法组、chat WS（`?since=`）、PM 历史/搜索、trigger 复用会话 | append-only、seq 从 0 强制连续、批内单事务原子、updated_at 同事务 | **IndexedDB**（D2 已决）；事务/seq 语义可映射；SQL LIKE 检索需 JS 重写 |
| 2 | `.spherse/` 项目文件树 | project.yaml / profile.md(+frontmatter) / theme.css / mcp.json / skills/ / triggers/ / memory/core.md / AGENTS.md / CHANGELOG.md | `store/project.ts` ProjectStore 聚合 + 各子 store；写面 PM 门面（`project-manager.ts:403-490`） | REST/RPC agents、skills、trigger、agent-mcp、agent-memory、settings、preview 资源面、前端 store | 文件级原子（tmp+rename / mutex）；无跨文件事务；磁盘是唯一真相源 | **OPFS 直存可行**（纯文本文件树）；需 OPFS 文件系统适配层；原子 rename 跨浏览器是缺口 |
| 2b | memory.db | `.spherse/agents/{slug}/memory/memory.db`（SQLite + FTS5 trigram） | `store/memory.ts` MemoryStore | REST/RPC agent-memory 方法组、memory 工具（memory_save/recall 等） | 损坏隔离重建；core.md 串行写链 | **IndexedDB**（D2 已决）；FTS5 无等价物，需 JS 检索 |
| 2c | `*.data.json` 活网页数据 | 项目根用户区 + `.spherse/data/cards/` 例外前缀 | `capabilities/data/data-store.ts` DataStore | REST/RPC data 方法组、SDK `data.*`、agent `read_data/mutate_data` | tmp+rename 原子、mutex 锁内 RMW、sha256 version + ifVersion 乐观锁、幂等 LRU、20MB 上限 | **OPFS 直存可行**（JSON 文件 + 锁语义单 Worker 内天然可保）；乐观锁纯算法可平移 |
| 3 | 用户级/全局设置 | `model-settings.json`（desktop: userData）；electron-store `settings.json`；web/app localStorage | server-owned `server/src/model-settings.ts`；desktop `electron/settings.ts` | REST/RPC settings 方法组；desktop main（窗口/托盘/tunnel/IPC） | tmp+rename 原子；明文 API key；sanitize 只回 `configured` | model-settings → **浏览器存储 + AuthProvider service**（D2 已决）；prefs/localStorage 已是浏览器原生 |
| 4 | attachments/ 上传 | `.spherse/attachments/`（图片 ≤5MB）；通用上传至项目任意目录（≤100MB） | 写经 PM 门面 `writeBinaryFile`；core 消费 `attachments/image-processor.ts` | chat Composer 上传、多模态 LLM 调用（仅本轮） | 唯一命名免锁；无级联删除 | **OPFS 直存可行**；browser 上传已决 RPC Blob 直传 Worker（D6） |
| 5 | marketplace zip | `os.tmpdir()` 临时区（无持久缓存目录） | server `marketplace.ts` 下载 + core `SkillStore.installSkill` / `marketplace-project.ts` 解压安装 | REST/RPC marketplace、skills 方法组、UI SkillPanel / 项目市场对话框 | tmp 解压 + `moveDirAtomic` 原子落位 + finally 清理；zip-slip 防护 | skill 安装可行（adm-zip 纯 JS）；**项目市场 destDir=外部任意目录，browser 无此概念** |
| 6 | 缓存/派生数据 | 全部内存（fs-watcher 状态、historyCache、outlineCache、幂等缓存、scheduler 状态、preview 无盘上产物） | 各自模块 | bus fs-watch 通道、PM 分页、DataStore、TimerService | 均可随时丢弃重建 | 内存类直接复用；**fs.watch 无 OPFS 等价物，是唯一语义缺口** |

## 1. sessions.db（event-log + sessions 表）

### 数据形态 / schema

- 路径：`.spherse/agents/{agent-slug}/sessions.db`，**每个 agent 一个 SQLite 文件**，惰性创建（首次访问会话时），由 `AgentStore.sessions` getter 组装：`core/src/store/agent-store.ts:101-111`（`path.join(agentDir, "sessions.db")` 在 :104）。
- 打开即 `journal_mode = WAL`：`core/src/store/session.ts:136`。
- Schema（`MIGRATION`，`core/src/store/session.ts:77-115`）：
  - `sessions` 表（列表元数据）：id/agent_id/title/created_at/updated_at/status(active|archived)/source（:78-86）
  - `events` 表（**append-only，主键 `(session_id, seq)`**）：type/data(JSON)/time/schema_version（:106-114）
  - legacy `messages` / `compactions` 表：已发布旧数据只读保留，供迁移前历史展示（:88-104）
- 增量迁移（pragma 探测补列）：source / parent_session_id / fork_seq / migrated_at / prev_message_id / message_content_schema_version，`core/src/store/session.ts:145-169`。

### 读写入口（core owns）

- 全仓库 better-sqlite3 **仅** `core/src/store/session.ts:1` 与 `core/src/store/memory.ts:1`（+测试）；server/desktop 零直连。SessionStore 已是唯一接缝。
- append：`SessionStore.appendEvents`（`core/src/store/session.ts:231-258`）——单个 `db.transaction` 内：`SELECT MAX(seq)` → 首事件 seq 必须等于 `maxSeq+1`（:243-247）→ 批内逐个连续性校验（:249-252）→ INSERT → 同事务 `UPDATE sessions.updated_at`（:255）。
- 内存侧封装：`SessionEventLog`（`core/src/session/event-log.ts`）——`appendBatch` 先推内存再落库、落库失败回滚内存（:25-60，回滚 :46-49）；`open` 时全量读回并校验 seq 从 0 连续，损坏即抛（:73-83）。
- 读：`readEvents` / `readEventsAfter`（since 续传）/ `readEventCount` / `maxSeq`（`session.ts:260-306`）。
- 搜索：`searchMessages` SQL `LIKE` 预取 + 内存二次匹配 + abandoned seq 过滤（`session.ts:308-363`）。
- 软删除：`archiveSession` 仅置 `status='archived'`（`session.ts:224-229`）；重命名只改 title 不动 updated_at（:550-555）。
- legacy 迁移：`migrateEvents`（空表校验 + 单事务写入 + `migrated_at` 标记，`session.ts:365-401`）、`sessionNeedsMigration`（:412-421）、入口 `migrateLegacySession`（`core/src/session/legacy-migrate.ts`）。

### 消费方

- REST `server/src/routes/sessions.ts`（已标 deprecated，P2 删）。
- RPC：`rpc/src/methods/sessions.ts`（listProject/search/listByAgent/get…）与 `chat.ts`（事件订阅）；server 侧扩展组在 `server/src/rpc/methods/registry.ts:8-25` 注册。
- chat WS `?since=`：`server/src/chat/ws-chat.ts:40-42` → `chat-replay.ts:48-60`（session_ready 携带 lastSeq + replay_events 分批）。
- PM 读面：`getSessionHistory` / `getRecentSessionHistory`（fold 投影 + LRU 缓存）/ `searchProjectMessages`（`core/src/project-manager.ts:275-344`，historyCache :40-63）。
- trigger reusable_session 绑定写回（`core/src/trigger/executor.ts:105`）；compaction 以 `compaction/applied` 事件表达（`core/src/capabilities/compaction/transform.ts:60`）。

### 事务与一致性要求

- **append-only**：消息与控制事件只追加；compaction/retry/withdraw 均为重启点事件（docs/official/data-conventions.md「Session 数据」节）。
- **seq 单调且强制连续**（从 0，批内无 gap，PK 兜底唯一）。
- **批内原子**：单 SQLite 事务，含 updated_at；内存投影失败回滚。
- 跨表关联弱：events↔sessions 靠同一事务维持（FK 未启用强制），archive 只改 sessions 行、events 永不删。

### browser 版约束评估

- **结论：IndexedDB**（D2「browser 插件 = IndexedDB（sessions/memory）+ OPFS（项目文件）」已决）。
- 语义映射可行点：appendEvents 的「maxSeq 校验 + 批量写 + updated_at」可落在一个 IDB 事务内；`readEventsAfter` 即范围游标；seq 连续校验是纯逻辑可平移。
- 需要重实现的点：`ORDER BY updated_at DESC` 分页（IDB 需自建索引）、`searchMessages` 的 SQL LIKE 预取（全量扫 + JS 匹配，或维持内存索引）、崩溃恢复语义（WAL 无等价物，靠 IDB 事务耐久性 + open 时连续性校验兜底——该校验逻辑已有，直接复用）。
- sqlite-wasm + OPFS 技术上可行（sync handle 独占锁与单写者约束同构），但设计已选 IDB，且 wasm 方案引入体积/锁管理成本，不建议改线。

## 2. `.spherse/` 项目文件树

### 数据形态与 owner

| 文件/目录 | 格式 | owner store | 证据 |
|---|---|---|---|
| `.spherse/project.yaml` | YAML（id nanoid(8)/name/created/welcomePage/sidePanel/aiAccess） | `ProjectConfigStore` | `core/src/store/project-config.ts:31`；读时 id 缺失补种回写 :60-64；写全量 `YAML.stringify` :69-72；装配于 `ProjectStore.open` `core/src/store/project.ts:64-77` |
| `.spherse/agents/{slug}/profile.md` | Markdown + YAML frontmatter（gray-matter 手工解析，无 schema 校验） | `AgentProfileStore` | `core/src/store/agent-profile.ts:44`；read/parse :55-152（id 缺失自动生成回写 :121-124）；save 保 id/createdAt :59-83 |
| `agents/{slug}/theme.css`（agent）与 `.spherse/theme.css`（项目） | CSS 文本 | AgentProfileStore / PM 门面 | agent 级 `agent-profile.ts:98-108`；项目级读 **server 直读**（`server/src/routes/settings.ts:145-153`、RPC `server/src/rpc/methods/settings.ts:80`）、写走 `pm.writeFile`（`routes/settings.ts:167`） |
| `agents/{slug}/mcp.json` | JSON `{servers:[...]}`（stdio/http，可含敏感 headers/env） | `McpConfigStore` | `core/src/store/mcp-config.ts:8-40`（读 :17-30、写整文件 :32-40） |
| `agents/{slug}/memory/core.md` | Markdown 纯文本（≤4000 字符） | `MemoryStore`（core.md 部分） | `core/src/store/memory.ts:137-142`；串行写链（enqueueCoreWrite）:178-219 |
| `agents/{slug}/skills/`、`.spherse/skills/`、`.agents/skills/`（兼容） | 目录 + `SKILL.md`（frontmatter name/description/version）+ 附加文件 | `SkillStore` | `core/src/store/skill.ts:36-52`；合并优先级 agent > `.spherse/skills` > `.agents/skills` > builtin :54-87；项目级实例化 `project.ts:69-74`、agent 级 `agent-store.ts:117-122` |
| `agents/{slug}/triggers/index.yml` | YAML 数组 `TriggerEntry[]`（含运行时写入的 boundSessionId） | `TriggerStore` | `core/src/store/trigger.ts:13-18`；list :20-29；saveAll **整表重写** :36-45 |
| `agents/{slug}/triggers/logs.jsonl` | JSONL 追加日志 | TriggerStore | append + 2MB/5000 行轮转 :74-92 |
| `agents/{slug}/assets/` | 静态资源（LLM 读写、server 只读） | 无专属 store，走文件工具/门面 | 类别 `agentAssets`：`core/src/access/path-category.ts:48` |
| 根 `AGENTS.md` / `CHANGELOG.md` | Markdown | ProjectStore | 创建写模板（wx 不覆盖）`project.ts:98-102`；readIndex/updateIndex/appendChangelog :259-279 |
| `.spherse/generated-images/` | 图片二进制，`{yyyyMMddHHmmss-UTC}-{4hex}.{ext}` | generate_image 工具 | `core/src/tools/generate-image.ts:39`、写盘 :161-171 |

路径类别全集（19 类 + userFiles 兜底，含 `agentSessions`/`agentMcp` 永不可读）固定在 `core/src/access/path-category.ts:33-53`。

### 写入是否必须走 core 门面（resolveProjectPath 红线）

- **写面已收口**：PM 的 writeFile/createEntry/deletePath/renamePath/copyFileWithin/writeBinaryFile 全部 = `resolveProjectPath` + `serverAccessPolicy().assertWrite` + `FileWriteMutex`（`core/src/project-manager.ts:403-490`）；LLM 文件工具（write-file/edit-file/move-file/copy-file）与 DataStore 在 core 内同样经 path-safety + policy + mutex。仓库级红线见根 AGENTS.md「路径安全」。
- 例外（core 内刻意绕开 mutex）：generate_image 唯一命名 + existsSync 重试后直写（`generate-image.ts:164-171`），依赖「新文件名不冲突」而非锁。
- 并发原语：`FileWriteMutex`（`core/src/utils/file-write-mutex.ts`）、目录原子移动 `moveDirAtomic`（`core/src/utils/fs-move.ts`）、skill 安装备份+回滚（`skill.ts:173-200`）。

### `*.data.json`（DataStore，单列因为它跨 SDK/agent 两个写入方）

- `core/src/capabilities/data/data-store.ts:46`：tmp（同目录隐藏文件）+ rename 原子落盘（:118-121）、mutex 锁内读-改-写（:165）、sha256 内容哈希 version + `ifVersion` 乐观锁（:166-169）、`idempotencyKey` LRU 1024（:32、:133-154）、单文件 20MB 上限（:31）、损坏（撕裂 JSON）报 `file_corrupted` 不自动修复（:76-84）。

### 消费方

- REST/RPC：agents、skills、trigger、agent-mcp、agent-memory、agent-write、settings（welcome/side-panel/ai-access/theme）、data 方法组（server routes + `server/src/rpc/methods/*`、`rpc/src/methods/*`）。
- 资源面：preview 反代直接读 theme.css / 欢迎页 / side panel / assets 配图（`server/src/routes/preview.ts`）。
- 前端：app 各 feature store 经 api/RPC；skill 面板、Agent Dialog、trigger 面板、记忆 dialog 等。

### 事务与一致性

- 文件级原子（tmp+rename 或 mutex 内写）；**无跨文件事务**。
- profile 保存有 id/createdAt 保序（读旧 frontmatter 回写，`agent-profile.ts:65-76`）。
- TriggerStore index.yml 无锁整表重写；磁盘是唯一真相源，TimerService 每 tick 重读（`core/src/trigger/scheduler.ts:58-74`）。

### browser 版约束评估

- **OPFS 直存可行**：全部是路径寻址的文本/二进制文件；gray-matter、yaml 均纯 JS 可共用；解析逻辑（各 store 的 parse 层）与路径安全/类别判定（纯字符串逻辑）可直接复用。
- 需要一个 OPFS 文件系统适配层补齐：mkdir -p、rm -r、rename、目录遍历（readdir withFileTypes 语义）、tmp+rename 原子写。
- **缺口**：`FileSystemFileHandle.move()`（原子 rename）目前仅 Chromium 实现——tmp+rename 原子写模式在 Safari/Firefox 的 OPFS 上无直接等价（单写者前提下退化为 write-in-place + flush，崩溃撕裂窗口由「open 时校验/损坏即隔离」兜底，与 memory.db 现有策略同构）。
- FileWriteMutex 在唯一 SharedWorker 内保留即可（进程内串行语义不变）。

## 3. 用户级 / 全局设置

| 数据 | 位置 | 读写方 | 一致性 | browser 评估 |
|---|---|---|---|---|
| model-settings（providers/keys/defaultModel/sampling/thinkingLevel/customProviders） | desktop：`{userData}/model-settings.json`，路径由 host 经 `CreateServerOptions.modelSettingsPath` 注入（`desktop/electron/settings.ts:38-40` → `desktop/electron/server.ts:57` → `server/src/index.ts:120`）；纯 Node 运行缺省路径 = **纯内存不落盘** | server-owned `ModelSettingsStore`（`server/src/model-settings.ts:58`）：读 :67-75、写 tmp+pid+ts rename :127-132；REST `routes/settings.ts:38-60` + RPC `rpc/methods/settings.ts`；生效经 `applyModelSettingsToEnv`（process.env 注入 + `SPHERSE_IMAGE_*` + customProviders 同步 ModelCatalog，:163-181） | tmp+rename 原子；**明文 API key**；GET 只回 per-provider `configured` 布尔（sanitize :81-97）；reset-app-data 一并删除（`desktop/electron/ipc/debug.ts:37`） | D2 已决：AuthProvider service，key 存浏览器存储 + `createProvider` 显式 ApiKeyAuth 重建（替换 env 注入链）。**IndexedDB 明文 key 的安全性是产品级开放点**（与现状明文 JSON 同级，但浏览器存储可被同源 JS 读） |
| desktop host prefs / mobileAccess / serverToken / openProjects / lastActiveProject | electron-store `settings.json`（userData） | desktop main 专属（`desktop/electron/settings.ts:34-36`；hostPrefs :42-79、serverToken :167-182）；经 general/desktop 两条 IPC 通道读写 | electron-store 自身原子写；`serverToken` 是 server 鉴权唯一凭据 | desktop 专属，browser 版无对应物（鉴权模型不同：无 host-guard token 需求）；legacy `settings` key 启动迁移（`migrate-legacy-settings.ts`，幂等） |
| web/app 偏好与 UI 状态 | localStorage：`spherse:prefs`（`web/src/host-bridge-web.tsx:26`）、`spherse:draft:{sessionId}`（Composer.tsx:45-107）、`spherse:tabs`、split-pane、floating-browser、floating-content-browser、`spherse:side-panel:pinned`、`spherse:custom-side-panel:active-by-project`、last-route、`spherse:rpc-client` | renderer 各 store | 纯客户端，无跨端同步 | **已是浏览器原生**，browser 版直接沿用（同 origin 即同数据）；桌面版这些 key 存在于 renderer 的 file:// origin 下，与 browser 版天然隔离，无需迁移 |

## 4. attachments / 上传文件

- **图片附件**：`POST /api/projects/:id/attachments`（`server/src/routes/attachments.ts:25-89`）——Fastify multipart，仅 png/jpg/webp、≤5MB（:12-13），命名 `{epoch-ms}-{8hex}.{ext}`（:68），写经 **PM 门面** `pm.writeBinaryFile`（:80，core `project-manager.ts:483-490`，attachments 类别 srvWrite 允许）。
- **通用上传**：`POST .../upload/*`（`server/src/routes/upload.ts`）——≤100MB（:9）、目标目录重名 dedupe `(n)`（:12-23）、写经 `pm.writeBinaryFile`（:94）。
- **core 消费**：`attachments/image-processor.ts:8-19` 强制路径在 `.spherse/attachments/` 内，读文件转 base64 image block——**仅在本轮 LLM 调用瞬间存在**；sanitizer 在持久化前剥离 base64，`_attachments` 元数据随 `user/message` 事件进 event-log（`core/src/session/agent-runner.ts:163-171`、`core/src/attachments/sanitizer.ts`）。
- **大小量级**：单附件 ≤5MB；通用上传 ≤100MB；无总量配额。
- **生命周期**：**无级联删除**——会话归档只改 status（`session.ts:224-229`）；agent 删除只删 agent 目录（`project.ts:239-249`）；attachments 是项目级目录，唯一删除入口是显式 `DELETE .../attachments`（按 path，`routes/attachments.ts:91-122`）。
- **browser 评估**：OPFS 直存可行（二进制、唯一命名、无事务需求、无 watcher 需求）；上传路径 D6 已决——browser 走 RPC（structured clone 传 Blob，SharedWorker 内 runtime 统一写 OPFS，保持存储单属主），桌面继续 Fastify multipart。

## 5. marketplace / skills 安装的 zip 落盘

- **无持久缓存目录**：manifest 是 30s 内存缓存（`server/src/marketplace.ts:29`、:70-80）；zip 流式下载到 `os.tmpdir()`（:150-174，skill 50MB / project 100MB 上限 :33-34，同源 SSRF 校验 :124-127）。
- **skill 市场安装**：downloadZip → `pm.installSkill(zipPath, {overwrite:true})` → **finally 删除 zip**（RPC `server/src/rpc/methods/skills.ts:52-79`；REST 副本 `routes/marketplace.ts:35-60`）。解压同样在 `os.tmpdir()` 临时目录，安装后 finally 清理（`core/src/store/skill.ts:156-203`）；覆盖安装有备份 + 失败回滚（`moveDirAtomic`，:173-200）。
- **本地 zip 安装**：同 `SkillStore.installSkill`（zipPath 由调用方给定，`skill.ts:114-210`）；zip-slip 防护 :159-164。
- **项目市场安装**：`core/src/marketplace-project.ts:53-113`——tmp 解压 + zip-slip 校验 + **destDir（用户指定目录）** 下同名自增（:38-46）+ `moveDirAtomic` 原子落位 + finally 清 tmp（:110-112）；落盘后经 open-project IPC 注册。
- **提示词市场**：纯 fetch + 内存缓存，零落盘（`server/src/prompt-marketplace.ts:35-40`）。
- **browser 评估**：adm-zip 纯 JS 可进 Worker；skill 安装目标 `.spherse/skills` 在 OPFS 内可行（staging 区可用 OPFS 临时目录替代 os.tmpdir）。**阻塞点**：项目市场 `destDir` 是项目树之外的任意用户目录——browser 版没有外部文件系统概念，需收敛为「OPFS 内固定父目录」或引入 File System Access API（应作为能力矩阵项裁剪，对齐 D8 风格）。

## 6. 缓存 / 派生数据

| 项 | 位置 | 性质 | 证据 | browser 评估 |
|---|---|---|---|---|
| fs-watcher 状态 | server 进程内存（模块级 Map） | `fs.watch(recursive)` per project + listener 引用计数 + error 自愈；类别过滤只报用户可见面 | `server/src/bus/fs-watcher.ts:32-90`（过滤 :5-19） | **无 OPFS 等价物（OPFS 无变更通知）**——bus fs-watch 通道语义缺口，需轮询/写路径事件替代或降级（前端现有 `resumedAt` 全量对账可兜底） |
| PM historyCache | core 内存 | fold-on-write 投影缓存，LRU 32，以 eventCount 为版本号失效 | `core/src/project-manager.ts:18-19`、:40-63 | 纯内存逻辑，直接复用 |
| DataStore outlineCache / 幂等缓存 | core 内存 | outline LRU 64；idempotency LRU 1024 | `core/src/capabilities/data/data-store.ts:32`、:50、:133-154 | 直接复用 |
| trigger scheduler 状态 | core 内存 | 磁盘是唯一真相源，每 tick / 每事件重读 index.yml | `core/src/trigger/scheduler.ts:58-74` | 语义可平移（依赖 TriggerStore port） |
| ModelCatalog customProviders | core 内存 | 由 model-settings 同步 | `server/src/model-settings.ts:177-180` | 随 AuthProvider service 改造 |
| preview 产物 | **无盘上产物** | Fastify 直接从项目目录流式读 + 内存注入 SDK 脚本 | `server/src/routes/preview.ts` | 无迁移负担；browser 版走 SW 虚拟路由（P4，已列计划） |
| chat run snapshot / debug sink | 内存推送 | 不落盘 | `server/src/chat/chat-run-snapshot.ts`、`server/src/lib/debug-sink.ts:15-32` | 直接复用 |

## 设计问题 A：绕过门面直连 fs/sqlite 的点

sqlite：**零绕过**（better-sqlite3 仅 core 两处，见 §1）。fs 直连清单（按收口优先级）：

1. **server RPC 读面直连（P1 平移的遗留，首要收口对象）**：`server/src/rpc/methods/content.ts:21-52`（readFileContent/walkDir）、:96/:117/:137/:142（stat/readdir）；`server/src/rpc/methods/settings.ts:80`（`.spherse/theme.css` 直读）。这些逻辑从 deprecated REST 原样平移（REST 副本：`routes/content.ts:17-30`、`routes/file-tree.ts:25-41`、`routes/upload.ts:47/:86`、`routes/settings.ts:145-153`）——**RPC 化没有顺带收口，读面直连被复制进了新层**。写面则全部走 PM 门面（`routes/settings.ts:167`、`routes/content.ts:114/135/156/176`、`routes/upload.ts:94`、`routes/attachments.ts:80/116`）。
2. **资源面直连（设计保留，非收口对象）**：`routes/preview.ts`、`routes/download.ts`（createReadStream 直读项目文件）——D6 明确留在资源面；browser 版由 SW 虚拟路由等价重实现（P4，安全敏感面已有共用语义测试计划）。
3. **tmp 区直连（平台实现细节，随 store 插件走）**：marketplace zip 下载与清理（`marketplace.ts:150-174`、`rpc/methods/skills.ts:76`、`rpc/methods/marketplace.ts:52`）、skill/project 安装解压 staging（`skill.ts:156-157`、`marketplace-project.ts:84`）。
4. **app 级自有存储（平台插件归属，不算绕过）**：`model-settings.ts`（server-owned JSON）、desktop electron-store（host prefs）。
5. **desktop host 面（host 职责，非项目存储）**：`ipc/debug.ts:37`（rm model-settings）、`migrate-legacy-settings.ts`（一次性迁移写 model-settings.json）、`ipc/project.ts`（打开项目前目录只读检查）、`tray.ts`/`tunnel/cloudflare-provider.ts`（existsSync 探测图标/cloudflared）。
6. **core 内部例外**：`generate-image.ts:161-171` 直连 fs 写 generated-images（刻意不走 mutex，唯一命名保证）；fs 工具族与 DataStore 即门面本体，随平台插件整体替换。

**结论**：写路径收口良好；抽象前需先把**读面**（stat/content/file-tree/theme 读）收进 core 门面或 ContentStore 读端口，RPC 方法组改为纯委托——这是 browser port 的前置收口点。

## 设计问题 B：event-log append 是否已是「单写者 + seq 单调」

**是，且为强制连续（非仅单调）**。证据链：

1. **seq 单调/连续（存储层强制）**：`appendEvents` 单事务内 `SELECT MAX(seq)` → 首事件必须等于 `maxSeq+1`，批内逐个校验连续，违反即抛（`core/src/store/session.ts:242-252`）；主键 `(session_id, seq)` 兜底唯一（:106-114）。
2. **批内原子 + 失败回滚**：单 `db.transaction` 包裹全部 INSERT 与 updated_at（:242-256）；内存侧落库失败回滚已推入的 entries（`core/src/session/event-log.ts:46-49`）。
3. **打开即校验**：`SessionEventLog.open` 全量读回，任一 `seq !== index` 抛 Corrupt（`event-log.ts:76-80`）——损坏可检测，与 OPFS sync handle「失败可检测、不静默交错」的特性同构。
4. **单写者（进程/会话/文件三级）**：
   - 进程级：桌面只有一个 server 进程装配全部 runtime（`desktop/electron/server.ts` → ProjectRegistry，`server/src/registry.ts:63-129` per-root 去重装配）。
   - 会话级：每 sessionId 在 `SessionManager.sessions` Map 中至多一个 AgentRunner（`core/src/session/session-manager.ts:15`），restore 有 pendingRestores 去重（:54-85）；**全部 append 都经该 runner 的 eventLog**——turn/消息/控制事件（`core/src/session/agent-runner.ts:97/174/241/488/498/524`）、compaction（`capabilities/compaction/transform.ts:60`）、trigger 复用会话（经 SessionPort，`core/src/factory.ts:103-110`）；`sendMessage` 只路由到活跃 runner（`session-manager.ts:141-151`）。
   - 文件级：per-agent 独立 sessions.db（`agent-store.ts:104`）+ WAL（`session.ts:136`）+ better-sqlite3 同步 API（进程内天然串行）。
5. **消费面已按 seq 续传**：chat WS `?since=`（`ws-chat.ts:40-42`）→ `readEventsAfter` + `session_ready{lastSeq}` + 分批 replay（`chat-replay.ts:48-68`）——D7 replayable 契约的现成语义源。

**内化 OPFS 约束的注意点**：现状 append 是同步调用、调用方无重试/排队；IDB 异步化后「maxSeq 校验 + 批量写」必须收敛在**同一个 IDB 事务**内（否则并发 await 窗口可产生 gap 竞争）；单写者前提本身由 D5「store 实例只活在唯一 SharedWorker」保证，browser-matrix 实测（sync handle 独占锁）已验证违反属主时是可检测失败而非静默丢写。

## 关键风险（供端口设计与 P3 排期参考）

| # | 风险 | 影响 | 证据/说明 |
|---|---|---|---|
| R1 | fs.watch 无 OPFS 等价物 | bus fs-watch 通道（文件树实时刷新）语义缺口 | `server/src/bus/fs-watcher.ts`；OPFS 无变更通知，需轮询/写路径内建事件/前端对账兜底，P2 契约需显式定义 |
| R2 | tmp+rename 原子写依赖 rename 原子性 | DataStore/model-settings/各配置写的崩溃一致性 | `FileSystemFileHandle.move()` 仅 Chromium；Safari/Firefox OPFS 需降级策略（单写者 + write-in-place + 损坏检测兜底） |
| R3 | SQL 依赖面（LIKE 预取、FTS5 trigram、ORDER BY 分页） | sessions 搜索与 memory recall 需 JS 重实现 | `session.ts:308-352`、`memory.ts:268-303`（LIKE 兜底已有先例可参照）；IDB 索引设计进 store 语义测试 |
| R4 | RPC 读面直连 fs 已随 P1 平移 | browser port 前必须收口，否则 RPC 层出现第二套 fs 依赖 | `server/src/rpc/methods/content.ts:21-52`、`settings.ts:80`（见问题 A-1） |
| R5 | 项目市场 destDir = 项目树外任意目录 | browser 版无外部 FS 概念，安装语义不可平移 | `marketplace-project.ts:79-108`；需能力矩阵裁剪或 File System Access API |
| R6 | append 异步化后的竞态窗口 | seq 连续性被并发 await 破坏 | 见问题 B 注意点；store 语义测试须含「并发 append 全部串行且无 gap」用例 |
| R7 | 明文 API key 进浏览器存储 | 同源 XSS 面扩大（桌面明文 JSON 仅本地用户可读） | `model-settings.ts:127-132`；属 AuthProvider 设计的产品级决策，建议随 P3 显式评估（内存持有 + 可选持久化） |
| R8 | legacy messages/compactions 迁移逻辑绑定 SQLite | browser 版无 legacy 数据（红线：不为未发布格式写迁移），但 `sessionNeedsMigration` 分支遍布读路径 | `session.ts:365-431`、`project-manager.ts:279-305`；端口化时建议以「browser 实现恒返回 false」收编该分支 |
