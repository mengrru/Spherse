# [Feature] *.data.json 选择性读写 — $manifest 驱动的数据工具与并发安全

> 日期：2026-08-20
> 范围：core（DataStore 服务 + 3 个 agent tool）、server（data 路由 + contracts）、app（UI SDK data handler 迁移）、presets（write-html / use-ui-sdk skill）

## 1. 背景与问题

`*.data.json` 是「活网页」的数据载体：agent1 生成 `page.html + page.data.json`，用户通过 HTML（UI SDK `data.*` action 或 `fetch`）增删改查数据，agent2（可能多个、可能并发）读写同一文件与用户形成互动。

当前问题：

1. **上下文浪费**：agent 只有 `read_file`，每次读整个文件。数据文件随使用增长（游戏存档、清单、历史记录），agent 反复读整文件烧掉大量上下文。
2. **语义丢失**：agent2 没有生成时上下文，不知道数据的业务含义（`status` 的合法枚举、id 谁生成、新增条目要补哪些字段），写入全靠猜，写坏后页面渲染崩溃且是静默脏数据。
3. **并发不安全（现状即有隐患）**：UI SDK `data.set/delete` 在 renderer 端做读-改-写（`packages/app/src/ui-sdk/handlers/data.ts`），无锁、无版本、非原子写；agent 侧 `write_file`/`edit_file` 走 `FileWriteMutex` 但 SDK 不走。SDK 写与 agent 写并发时互相覆盖（丢失更新），进程崩溃时可能留下半个 JSON。

## 2. 目标

- agent 按「业务入口」一跳读写数据文件，不再整文件进上下文
- agent1 生成数据文件时，把业务语义（查询/变更入口）随文件传递给后续 agent
- 所有 `*.data.json` 写入（SDK 与 agent）收敛到同一服务：原子落盘、锁内 RMW、可重试幂等、版本可探测
- 无 manifest 的存量文件自动降级可用（结构大纲 + 局部读）

### 非目标

见 §14「不做的事」。

## 3. 方案选型

| 方案 | 结论 | 理由 |
|------|------|------|
| A. 静态读写 tool + 约定字段附路径说明 | ❌ 作为主方案 | 说明文本是给人看的，无业务规则；生成时写死、运行时漂移无法检测 |
| B. 动态注入 tool（为每个页面生成专属读写 tool） | ❌ 本期不做 | 生成代码执行安全边界、tool 槽位膨胀、tool 与数据结构演化脱节不可检测。作为平台能力留在后续 |
| C. 自动结构大纲（outline） | ✅ 保底层 | 运行时自动维护，零约定零漂移，覆盖一切文件；但只有语法没有语义，写入形状无保证 |
| D. JSONPath 查询 + RFC 6902 patch | ❌ 不做 | 需要实现一门查询语言 + 教会 agent 使用；开放表达式写入无权限边界 |
| E. 声明式 manifest（业务命名入口映射到路径+参数） | ✅ 主方案 | agent1 是数据形状的唯一知识源，manifest 是它向 agent2 传递业务语义的通道；声明式可静态校验、失真可检测可降级 |
| F. 存储后端（SQLite/分片） | ❌ 后续 | 文件不再是单一真源，架构改动大；触发条件：单文件 >5MB 或查询延迟可感 |

**最终形态 = E（内嵌 `$manifest`）+ C（outline 保底）+ server 侧集中 RMW 的并发安全基座。**

manifest 存放位置的决策：**内嵌在数据文件根部 `$manifest` 字段**（而非 sidecar 文件）。前提成立：本项目的读写都过自家门面（PM 门面 + UI SDK + 新 DataStore），可以承诺保留 `$` 前缀顶层键。收益：manifest 与数据原子共存（一次原子替换同时换掉数据和 manifest，不存在新数据配旧 manifest）、零寻址约定、漂移检测一次 IO。代价与缓解：绕过 SDK 的手写 JS 整体覆盖会丢 manifest → DataStore 检测到丢失时在 outline 中标记并可由 agent 重建；`$` 前缀声明为平台保留键。

## 4. 数据文件格式与 `$manifest` 约定

### 4.1 文件结构

```jsonc
{
  "$manifest": { /* 平台保留，见下 */ },
  "todos": [ /* 业务数据 */ ],
  "stats": { "hp": 80 }
}
```

- 顶层 `$` 前缀键为平台保留，业务数据不使用（skill 中约束）
- outline 生成、SDK `data.keys/entries` 遍历均排除 `$` 前缀键
- 其余格式与现状完全兼容：存量文件无需迁移，缺 `$manifest` 自动降级

### 4.2 manifest schema（v1）

```jsonc
{
  "$manifest": {
    "version": 1,
    "desc": "任务看板数据。todos 由页面与 agent 共同维护",
    "queries": {
      "listTodos": {
        "desc": "待办列表，默认按 createdAt 降序",
        "path": "todos",              // dot-path，相对文档根
        "identity": "id",             // 数组条目的稳定键（分页游标/更新定位用）
        "params": {
          "status": { "type": "enum", "values": ["pending", "done"], "desc": "按状态过滤" },
          "priority": { "type": "enum", "values": ["low", "medium", "high"] },
          "sort": { "type": "field", "desc": "排序字段，默认 createdAt" },
          "dir": { "type": "enum", "values": ["asc", "desc"], "default": "desc" }
        },
        "defaultLimit": 20
      }
    },
    "mutations": {
      "addTodo": {
        "desc": "新增待办",
        "op": "append",
        "path": "todos",
        "fields": {
          "title": { "type": "string", "required": true },
          "priority": { "type": "enum", "values": ["low", "medium", "high"], "default": "medium" }
        },
        "auto": { "id": "uuid", "createdAt": "nowIso" }
      },
      "setTodoStatus": {
        "op": "update", "path": "todos", "match": "id",
        "fields": { "status": { "type": "enum", "values": ["pending", "done"] } }
      },
      "removeTodo": { "op": "remove", "path": "todos", "match": "id" },
      "resetStats": { "op": "set", "path": "stats", "fields": { "hp": { "type": "integer" } } }
    }
  },
  "todos": [
    { "id": "…", "title": "买牛奶", "status": "pending", "priority": "medium", "createdAt": "2026-08-20T10:00:00Z" }
  ],
  "stats": { "hp": 80 }
}
```

要素说明：

| 要素 | 作用 |
|------|------|
| `queries.{name}.path` | dot-path 寻址（`todos`、`stats.history`），**不引入 JSONPath 语言** |
| `params` | 参数化过滤：enum 相等过滤 / field 指定排序字段 + dir；内置 `limit` / `after` 分页 |
| `identity` | 数组条目稳定键，用于游标分页与 update/remove 定位（不用易漂移的数组下标）。声明后 query 自动获得隐式参数「按该字段值相等查单条」（如 `listTodos(id=…)`），无需在 params 里重复声明 |
| `mutations.{name}.op` | `append` / `update` / `remove` / `set` 四种 |
| `fields` | 写入形状约束：类型、required、enum、default——把「写坏数据」从运行时崩溃提前为调用报错 |
| `auto` | server 侧自动补全：`uuid` / `nowIso`，id 生成规则不再依赖 agent 自觉 |
| `match` | update/remove 按 identity 字段值定位条目；**identity 字段值通过 args 中同名字段传入**（如 `setTodoStatus` 传 `{ id: "…", status: "done" }`），该字段隐式 required、类型必须为 string/number，且不在 `fields` 中重复声明 |

schema 用 TypeBox 定义在 core（`dataManifestSchema`），agent tool 与 server route 共用；skill 文档提供模板与完整示例。

## 5. 核心服务：DataStore（core）

新增 `packages/core/src/capabilities/data/`，核心是 `DataStore`——`*.data.json` 的**唯一写入门面**（SDK 写与 agent 写都汇到它）：

```ts
// packages/core/src/capabilities/data/data-store.ts
export function createDataStore(opts: {
  projectRoot: string;
  fileWriteMutex: FileWriteMutex;   // 复用全局实例：与 write_file/edit_file 等工具天然互斥
  logger: Logger;
}): DataStore

interface DataStore {
  // 读
  outline(file: string): Promise<OutlineResult>;                          // 结构大纲 + manifest 健康度 + version
  read(file: string, opts: { path?: string; offset?: number; limit?: number; ifVersion?: string }): Promise<ReadResult>;
  query(file: string, name: string, params?: Record<string, unknown>, page?: { limit?: number; after?: string }): Promise<QueryResult>;
  // 写（锁内完成整个 RMW）
  mutate(file: string, name: string, args: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<MutateResult>;
  rawSet(file: string, key: string, value: unknown, opts?: { ifVersion?: string }): Promise<WriteResult>;   // SDK data.set 后端
  rawDelete(file: string, key: string, opts?: { ifVersion?: string }): Promise<WriteResult>;                 // SDK data.delete 后端
  // 事件
  onChange(handler: (e: DataChangeEvent) => void): () => void;
}
```

装配：`assembleProject`/factory 中与 ProjectStore 同层创建，挂到 ProjectManager host；`dataCapability()` 的 tool 工厂与 server 路由都从 host/PM 取同一实例。**单进程内 SDK 与 agent 共享同一把 `FileWriteMutex`（按绝对路径 keyed），写写互斥成立。**

### 5.1 原子落盘

所有写入（mutate/rawSet/rawDelete/manifest 维护）统一走 `persist()`：

1. 在同目录写临时文件 `.{basename}.spdata.tmp`（点前缀降低 file-tree 观感影响，watcher 忽略列表同步添加该模式）
2. `fs.rename` 原子替换（同分区保证原子性）
3. 崩溃时：旧文件完好，至多残留孤儿 tmp（下次写入覆盖式清理）

进程写到一半崩溃不再产生半个 JSON。**不在本项内改造 PM 门面通用 writeFile 的原子性**（影响面全仓库，单列后续项）。

### 5.2 版本

- `version = sha256(文件字节)` 十六进制，只读不落盘（避免文件内版本号带来的写放大与真假源分歧）
- 所有读/写结果都带 `version`；`read`/`rawSet`/`rawDelete` 接受 `ifVersion`：不匹配返回冲突错误（携带当前 version），调用方重读后重试
- `mutate` 不需要 `ifVersion`：server 侧锁内 RMW 天然原子，last-writer-wins per mutation 即为正确语义
- agent 反复读同文件（等用户操作后再看状态）：`read` 带 `ifVersion`，未变化返回 `{ unchanged: true, version }`，上下文成本趋近于零

### 5.3 outline（结构大纲，保底层）

对无 manifest 或 manifest 失效的文件，从数据自动推断：

```
$outline of todos.data.json (312KB, version a1b2c3…)
- todos: array[152] of object { id: string, title: string, status: string(pending|done), priority: string, createdAt: string }
- stats: object { hp: number, mp: number, history: array[40] of number }
$manifest: healthy — entries:
  queries: listTodos(status?, priority?, sort?, dir?) → todos
  mutations: addTodo(title!, priority?), setTodoStatus(id!, status!), removeTodo(id!)
```

- **outline 必须包含 manifest 入口签名**（名称 + 参数概要，`!` 表示 required）：这是 agent 发现调用方式的唯一通道（dot-path 读 `$` 键被禁止，manifest 原文不可直接读）。manifest 保持小（skill 约束 ≤2KB），outline 总体目标 <4KB
- 结构部分排除 `$` 前缀键；数组元素形状取前 5 条的字段并集；≤8 个不同取值的字符串字段标注为疑似枚举
- 按 `(绝对路径, version)` 缓存，写后失效——外部写入（edit_file 等）改变 version 自然触发重算
- outline 顺带输出 manifest 健康度（见 5.4），agent 一次调用同时获得「结构 + 可用入口」

### 5.4 manifest 健康度（失真检测）

每次 `persist()` 后在内存中解析声明路径；outline 因缓存按 version 失效，外部写入（edit_file 等非 DataStore 路径）后的下次读取也会重算：

- path 仍可解析 → healthy
- path 失效 → 该入口标记 stale（outline 中列出）
- **`query`/`mutate` 执行时在锁内现场校验路径**，不信任缓存的健康度（防止外部写入后缓存过期的误放行）；失效返回 `manifest_stale` 错误并附 valid names + 建议 `read_data` 看_outline
- `$manifest` 整体丢失（外部整文件覆盖）→ outline 标记 `absent`；重建走 `edit_file`/`write_file` 整文件编辑（DataStore 拒绝 `$` 键的 rawSet/mutate，`$manifest` 的唯一写入路径就是整文件编辑，防 SDK 侧误写）

### 5.5 幂等

`mutate` 可带 `idempotencyKey`（调用方生成，如 `${sessionId}:${runId}:${seq}`）：DataStore 内存 Map（LRU，cap 1024，key 为 `file+idempotencyKey`）命中直接返回上次结果。应对版本冲突/网络重试导致的重复 `append`。进程重启丢失缓存可接受（重启后重试场景罕见）。

### 5.6 变更事件

每次 `persist()` 成功后同步发出：

```ts
type DataChangeEvent = {
  file: string;            // 项目相对路径
  version: string;
  origin: "sdk" | "agent"; // 写入来源（tool 调用 = agent，SDK 路由 = sdk）
  summary?: string;        // mutate 入口名，如 "addTodo"
};
```

- 供 trigger 引擎后续按 origin 过滤（agent 不响应 agent 写入，避免回声循环——本期只发事件，trigger 规则接线为后续项，见 §14）
- iframe 的 `file:update` 推送链路不变（fs.watch 原子 rename 正常触发）

### 5.7 查询引擎

- dot-path 解析到值；数组才支持过滤/排序/分页；identity 字段声明后自动支持按值相等查单条（隐式参数）
- 过滤 = manifest 声明的 enum 相等匹配；排序 = `sort`(field) + `dir`；分页 = `limit` + `after`（游标 = identity 键值的 base64，无 identity 时退化为 offset 并在结果中提示漂移风险）
- 文件本就全量 parse 进内存（单文件 ≤20MB 上限），引擎只做内存过滤切片——**省的是 agent 上下文，不是内存**
- 返回值裁剪：单条目 JSON 序列化 >4KB 截断该条目并标注（防单条巨对象撑爆上下文）

## 6. Agent Tools（3 个）

注册进新 `dataCapability()`（`packages/core/src/capabilities/data/index.ts`，加入 `builtinToolCapabilities()`），per-agent 可通过 profile `tools:` 关闭。工具命名对齐全库 `动词_名词` 风格：

| tool | 参数 | 行为 |
|------|------|------|
| `read_data` | `file`, `path?`, `offset?`, `limit?`, `ifVersion?` | 无 `path` 返回 outline（首次接触文件的标准入口）；有 `path` 返回 dot-path 局部值——**数组默认切片 limit=20**（返回 `total` 与翻页提示，防一次拉全量），`path: "."` 返回排除 `$` 键的文档根；带 `ifVersion` 时未变化返回 `unchanged` |
| `query_data` | `file`, `name`, `params?`, `limit?`, `after?` | 调 manifest query 入口，业务语义一跳查询 |
| `mutate_data` | `file`, `name`, `args?`, `idempotencyKey?` | 调 manifest mutation 入口，server 侧锁内原子执行 |

- 参数 schema 用 TypeBox；`name`/`params` 无法静态枚举（每个文件 manifest 不同），description 教导流程：*先 `read_data` 看 outline 与入口清单 → 按入口名调 `query_data`/`mutate_data`；文件无 manifest 时用 `read_data` 局部读 + `edit_file`/`write_file` 整文件改（并提示这是降级路径）*
- 访问控制：走同一 `AccessPolicyProvider`（read 类 `assertRead`，mutate 类 `assertWrite`）；沿用现有校验：必须 `.data.json` 后缀、禁止 `.spherse/`（卡片数据路径除外）
- tool result 均附 `version`，鼓励 agent 下一轮用 `ifVersion`

## 7. Server API

新增 `packages/server/src/routes/data.ts`，路由挂在现有项目前缀下（`/api/projects/:projectKey/data/*`），request/response schema 全部定义在 `packages/server/src/contracts/data.ts`（TypeBox），renderer ApiClient 复用同一 contract——遵守「不新增裸 JSON.parse / 泛型过界」规范。

**范围界定：server API 仅为 SDK（renderer）路径服务。** agent tool 与 DataStore 同进程，经 `dataCapability()` 直接调实例，不经过 HTTP。因此只暴露 SDK 实际需要的三条：

| route | body | 说明 |
|-------|------|------|
| `POST /data/read` | `{ file, path?, offset?, limit?, ifVersion? }` | `path` 缺省 → outline；`path: "."` → 文档根（排除 `$` 键，SDK `data.entries` 用）；其余为 dot-path 局部读；带 `ifVersion` 未变化返回 `unchanged`。SDK `data.get`/`data.keys`/`data.entries` 的统一后端 |
| `POST /data/raw-set` | `{ file, key, value, ifVersion? }` | SDK data.set 后端（拒绝 `$` 前缀 key） |
| `POST /data/raw-delete` | `{ file, key, ifVersion? }` | SDK data.delete 后端 |

query/mutate/outline 不设 HTTP route（无 renderer 消费方）；若未来出现远程 agent 或调试 UI 需要，再按需暴露。

错误语义统一：`manifest_stale` / `unknown_entry`（附 valid names）/ `version_conflict`（附当前 version）/ `validation_failed`（附字段错误明细）/ `file_corrupted`（外部撕裂写，不自动修复，报告 agent 与用户）。

## 8. UI SDK 对齐（renderer）

`packages/app/src/ui-sdk/handlers/data.ts` 从「renderer 端 RMW」改为「server 路由薄代理」：

- `data.get` / `data.keys` / `data.entries`：保持现有协议与白名单限流，读路径改走 `POST /data/read`（get 单 key 局部读；entries 走 `path: "."` 拿排除 `$` 键的全量对象；keys 由 entries 结果派生）
- `data.set` / `data.delete`：改走 `raw-set` / `raw-delete`——**RMW 移入 server DataStore 锁内，顺手修掉现状的丢失更新窗口**；`$` 前缀 key 拒绝
- postMessage 协议、iframe 侧 wrapper 零变化，存量页面无感
- 限流：沿用现有 `RATE_LIMIT_WHITELIST` 机制；`data.get` 维持白名单

## 9. 并发与边缘 case → 机制映射

| # | 边缘 case | 机制 |
|---|-----------|------|
| 1 | 丢失更新（agent vs agent / agent vs SDK） | 所有写收敛 DataStore，锁内完成整个 RMW；SDK 不再 renderer 端读改写 |
| 2 | 写入撕裂（进程崩溃留半个 JSON） | tmp + rename 原子落盘 |
| 3 | 非幂等重试重复写入 | `idempotencyKey` 内存去重 |
| 4 | 整文件写覆盖并发修改（降级路径：edit_file/write_file、rawSet） | `ifVersion` 乐观锁，冲突返回当前 version，调用方重读重规划 |
| 5 | 分页漂移（翻页间被插入/删除） | identity 游标分页（`after`），无 identity 时退化 offset 并提示 |
| 6 | manifest 与结构脱节 | persist 后健康度检测，stale 入口调用即报错 + outline 标注，可降级可重建 |
| 7 | 结构演化竞态（agent1 重生成页面 vs agent2 旧 manifest 写入） | 内嵌 manifest 与数据同文档原子替换，不会新数据配旧 manifest；旧入口调用得到 `unknown_entry`/`manifest_stale` 明确报错 |
| 8 | 多 agent 事件回声循环 | `DataChangeEvent.origin` 已区分 sdk/agent；trigger 侧「只响应 sdk origin」为后续项（§14） |
| 9 | 写放大/锁竞争（大文件高频写） | 20MB 上限沿用；版本用内容哈希不落盘；真瓶颈出现时触发存储后端方案（§14） |
| 10 | Content Browser 编辑器 dirty 态 vs agent 原子写并发（编辑器旧内容保存覆盖新数据） | 现状即有的问题，本 feature 使 agent 写更频繁而放大。P1 不解决，依赖现有编辑器 dirty/conflict 提示；彻底方案（编辑器对 `.data.json` 感知 version）列为后续观察项 |

## 10. 安全

- 路径安全：`resolveProjectPath` + `.data.json` 后缀白名单 + `.spherse/` 禁入（卡片路径例外）——复用现有 `validateFileParam` 语义，收敛进 core 供 tool 与 route 共用
- 访问策略（**仅 agent tool 侧**）：read/write 分别过 `assertRead`/`assertWrite`（与 fs 工具一致，LLM denylist 生效）。SDK 路由调用是**用户在页面上的直接操作**，不属于 LLM 访问，只受路径规则约束，不过 LLM 策略（与 ai-read-denylist 的「AI 读黑名单」语义一致）
- `$` 前缀顶层键：SDK `rawSet` 拒绝；`mutate` 引擎永不触碰 `$manifest` 之外的 `$` 键；manifest 本身只能通过整文件编辑演化（agent 重新生成页面时）
- 大小与成本：单文件 20MB 上限（沿用）；outline <2KB；query 单页默认 20、上限 100；单条目 4KB 截断

## 11. Skill 更新

### write-html（`packages/presets/skills/write-html/SKILL.md`）

新增「为会增长/需要 agent 互动的数据文件嵌入 `$manifest`」一节：

- 判据：数据是静态展示 → 维持现状；会增长、需要 agent 读写互动 → 必须嵌入 `$manifest`
- 生成时同源产出三件套：HTML（SDK 调用代码）+ 数据 + manifest——mutations 必须覆盖页面 SDK 代码实际会做的结构性变更，fields 枚举与页面渲染假设一致
- 业务键禁止 `$` 前缀；manifest 保持小（只放映射与 schema，不放示例数据）
- 提供完整 manifest 模板（todos 例子）与 dot-path 写法说明

### use-ui-sdk（`packages/presets/skills/use-ui-sdk/SKILL.md`）

- 说明 `data.set/delete` 已为原子操作，无需页面侧防并发；`$` 前缀 key 保留
- 引导结构性高频写入的数据页面在生成时同时声明 manifest（链接到 write-html skill）

## 12. 测试计划

**core 单元测试**（重点，遵循 core 覆盖率要求）：

- dot-path 解析（含数组下标不支持、越界、`$` 键不可寻址）
- outline：形状推断、枚举探测、`$` 排除、缓存失效、截断
- manifest 校验与健康度：合法/非法 schema、stale 检测（含外部写入后缓存过期场景下 mutate 现场校验兜底）、absent、outline 含入口签名
- 查询引擎：enum 过滤、sort/dir、limit/after 游标、identity 隐式按值查单条、无 identity 退化、单条目截断
- mutation：四 op、required/default/auto、enum 校验失败报错、match 定位失败报错（含 identity 字段隐式 required 校验）
- read 局部读：数组默认切片 limit=20 + total 返回、`path: "."` 排除 `$` 键、dot-path 越界与 `$` 键拒绝
- 幂等：同 key 重试去重、LRU 淘汰
- 版本：ifVersion 冲突、unchanged 探测
- 原子性：模拟 rename 前异常，断言原文件完好、无撕裂
- 并发：50 个并行 append 全部落盘（无丢失）；DataStore 与 write_file 工具共享 mutex 的互斥验证
- 事件：origin 正确、persist 失败不发

**server 契约测试**：三条 route（read/raw-set/raw-delete）的 schema 校验、错误码语义、`.spherse` 拒绝、policy deny；按仓库契约测试规范，server 侧至少一条**不 mock DataStore**（真 ProjectManager 装配）的端到端 route 测试。

**app 单元测试**：data handler 代理行为更新（协议不变断言）、`$` key 拒绝。

**E2E**（`packages/desktop`，按影响面选择场景）：

1. agent1 生成带 manifest 的页面 → 用户在 HTML 上 SDK set/delete → agent2 `query_data`/`mutate_data` 互动闭环
2. SDK 写与 agent mutate 并发（脚本压入）→ 最终状态无丢失
3. 存量无 manifest 大文件 → `read_data` outline + 分页局部读

## 13. 分期

- **P1（本 design 范围）**：DataStore（原子写/版本/outline/manifest/幂等/事件）+ 3 tools + server 路由 + SDK handler 迁移 + skill 更新
- **P2**：trigger 引擎消费 `DataChangeEvent`（origin 过滤、防回声、debounce）；`edit_file`/`write_file` 对 `.data.json` 的 ifVersion 提示接入
- **P3（触发式）**：存储后端、动态 tool 注入平台能力

## 14. 不做的事

- 不实现 JSONPath 过滤表达式 / RFC 6902 通用 patch（manifest 入口 + dot-path 局部读已覆盖需求）
- 不做动态 tool 注入（生成即执行的业务 tool）
- 不做跨文件事务、聚合统计（group by 等）
- 不改造 PM 门面通用 writeFile 的原子性（单列基础设施项）
- 不做 trigger 自动唤醒（本期只发 origin 事件）
- 不迁移存量文件（无 manifest 即降级，零迁移成本）
