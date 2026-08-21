# Implementation Plan: *.data.json 选择性读写 — $manifest 驱动的数据工具与并发安全

- 日期：2026-08-20
- Design：`docs/dev/features/2026-08-20-data-json-selective-access/design.md`（本计划不重复 rationale，只写 what/how/verify）
- 模式：按依赖顺序执行，每个 Task 独立可验证

## 任务依赖图

```
T1 manifest schema + dot-path + 校验（纯逻辑）
     │
     ▼
T2 查询引擎 + outline 生成（纯逻辑）
     │
     ▼
T3 DataStore 写路径（原子 persist/version/锁内 RMW/幂等/事件）
     │
     ▼
T4 DataStore 读入口 + mutate 执行器 + manifest 现场校验
     │
     ├──────────────► T5 dataCapability + 3 tools + 装配
     │                        │
     │                        ▼
     │                  T6 server contracts + 3 routes
     │                        │
     │                        ▼
     │                  T7 app SDK handler 迁移
     │                        │
T8 presets skills（T2 后任意时点插入）
                             │
                             ▼
                       T9 E2E + verify 全量
```

## 共享类型契约（各 Task 以此为准，勿自行变形）

```ts
// packages/core/src/capabilities/data/types.ts
export interface DataStore {
  outline(file: string): Promise<OutlineResult>;
  read(file: string, opts: { key?: string; path?: string; offset?: number; limit?: number; ifVersion?: string }): Promise<ReadResult>;
  query(file: string, name: string, params?: Record<string, unknown>, page?: { limit?: number; after?: string }): Promise<QueryResult>;
  mutate(file: string, name: string, args: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<MutateResult>;
  rawSet(file: string, key: string, value: unknown, opts?: { ifVersion?: string }): Promise<WriteResult>;
  rawDelete(file: string, key: string, opts?: { ifVersion?: string }): Promise<WriteResult>;
  onChange(handler: (e: DataChangeEvent) => void): () => void;
}

export type DataChangeEvent = {
  file: string;                 // 项目相对路径，posix 分隔符
  version: string;              // sha256 hex
  origin: "sdk" | "agent";
  summary?: string;             // mutate 入口名
};

// 版本冲突统一错误（server 映射 409 / tool 文本提示）
export class VersionConflictError extends Error { constructor(public currentVersion: string) { super("version conflict"); } }
export class ManifestStaleError extends Error {
  constructor(public entry: string, public kind: "query" | "mutation", public validNames: string[]) { super(`manifest entry stale: ${entry}`); }
}
export class UnknownEntryError extends Error { /* 同形状，附 validNames */ }
```

- 结果类型（`OutlineResult`/`ReadResult`/`QueryResult`/`MutateResult`/`WriteResult`）字段以 design §5–§7 为准，T1 内定义并导出，后续 task 只引用
- `origin` 取值规则：tool 调用路径传 `"agent"`，server route（SDK）路径传 `"sdk"`
- 版本 = `sha256(文件字节)` hex；outline 缓存 key = `(absolutePath, version)`

---

## Task 1: Core — manifest schema + dot-path + 校验器（纯逻辑，无 fs）

**依赖**：无。

**改动文件**：
- `packages/core/src/capabilities/data/types.ts` [新增]：上节共享契约 + 各 Result 类型
- `packages/core/src/capabilities/data/manifest.ts` [新增]：`dataManifestSchema`（TypeBox，design §4.2 完整要素：queries/mutations/params/fields/auto/match/identity/defaultLimit）+ `parseManifest(value): Manifest | null`（宽容解析，非法返回 null 而非抛）+ `validateManifestShape`（生成者侧严格校验，供 skill 文档与测试对齐）
- `packages/core/src/capabilities/data/dot-path.ts` [新增]：`getByDotPath(root, path)`（段分割、不支持数组下标、`$` 前缀段拒绝、根 `"."` 特判返回排除 `$` 键的浅拷贝文档）
- `packages/core/src/capabilities/data/validate.ts` [新增]：fields 校验器（required/type/enum/default 填充，返回 `{ value, errors }`）+ match 字段校验（隐式 required、string|number）+ query params 校验（enum 相等、未知参数拒绝）

**测试**（`packages/core/src/__tests__/capabilities/data/`，新建目录）：
- manifest：合法全要素解析、非法形状返回 null、`$manifest` 缺 version/queries 的宽容行为
- dot-path：普通/嵌套/越界/`$` 拒绝/`"."` 根/数组返回原引用
- 校验器：required 缺失、enum 越界、default 填充、类型不符、未知参数

**验证**：`npm test --workspace=packages/core`

---

## Task 2: Core — 查询引擎 + outline 生成（纯逻辑，无 fs）

**依赖**：T1。

**改动文件**：
- `packages/core/src/capabilities/data/query-engine.ts` [新增]：`runQuery(value, manifestQuery, params, page)`——enum 相等过滤（含 identity 隐式按值查单条）、`sort`(field)+`dir` 排序、`limit`+`after` 游标（identity base64；无 identity 退化 offset 并在结果标注 `pagination: "offset-drift"`）、`defaultLimit`、单条目 >4KB 序列化截断标注
- `packages/core/src/capabilities/data/outline.ts` [新增]：`buildOutline(doc, version, size)`——排除 `$` 键、数组形状取前 5 条字段并集、≤8 取值字符串标疑似枚举、含 `$manifest` 健康度 + **入口签名清单**（`name(req?, opt?) → path` 格式，`!` 后缀表 required）、目标 <4KB；`formatEntrySignature` 单独导出供测试
- outline 缓存（`(absolutePath, version)` LRU，cap 64）：放本 task 的 `outline-cache.ts`，T4 的 DataStore 消费

**测试**：
- 查询：过滤/排序/游标翻页不重不漏（中途插入干扰条目）、identity 单条查询命中与未命中、无 identity 退化、单条目截断、limit 上限 100 clamp
- outline：形状推断、枚举探测、`$` 排除、manifest healthy/stale/absent 三态、入口签名格式、超长截断
- 缓存：命中、version 变化失效、LRU 淘汰

**验证**：`npm test --workspace=packages/core`

---

## Task 3: Core — DataStore 写路径（原子性/版本/锁/幂等/事件）

**依赖**：T2（用 outline-cache；types 已在 T1）。

**改动文件**：
- `packages/core/src/capabilities/data/data-store.ts` [新增]：`createDataStore({ projectRoot, fileWriteMutex, logger })`
  - `persist(absPath, doc, origin, summary?)`：`JSON.stringify(doc, null, 2)` → 20MB 上限检查 → 同目录 `.{basename}.spdata.tmp` 写入 → `fs.rename` → sha256 计算 → outline 缓存失效 → `DataChangeEvent` 发射；**整个 persist 在 `fileWriteMutex.run(absPath, …)` 内**
  - `loadDoc(absPath)`：读文件（不存在 → `{}` 新文档语义）+ sha256；RMW 场景由调用方在锁内组合（见 T4）
  - **锁策略：只有 RMW（mutate/rawSet/rawDelete）持 `fileWriteMutex`；纯读（read/query/outline）不持锁**——rename 原子性保证读者拿到完整快照（version 由所读字节计算，自然一致），避免 agent 读阻塞在 SDK 写后
  - `rawSet`/`rawDelete`：锁内 load → 校验 key（`$` 前缀拒绝）→ 修改 → persist（origin 参数化，tool 侧传 agent / route 侧传 sdk）
  - 幂等：`idempotencyKey` Map（LRU cap 1024，key = `absPath + "\0" + idempotencyKey`）存 mutation 结果；命中直接返回
  - `onChange`：handler 集合 + 取消订阅
- `packages/core/src/capabilities/data/index.ts` [新增]：先只 `export { createDataStore }` 与 types（T5 扩充 capability）
- tmp 文件可见性：`.xxx.spdata.tmp` 点前缀已被 `list-files` 的 dotfile 过滤跳过、SDK file:update 订阅按路径过滤不会匹配——**无需改 file-tree/watcher**（实现时验证 fs-watch 对 rename 事件正常触发 data.json 的 file:update 即可）

**测试**：
- 原子性：注入 rename 前异常，断言原文件字节不变、无撕裂；tmp 残留时下次写入覆盖
- rawSet/rawDelete：`$` 拒绝、新文件自动创建、ifVersion 冲突抛 `VersionConflictError`（含当前 version）、成功后事件 origin/summary 正确
- 幂等：同 key 二次调用返回同结果且不重复写（文件 mtime/内容断言）、LRU 淘汰后重执行
- 并发：50 个并行 mutate/rawSet 无丢失（最终计数 = 50）；与 `write_file` 工具共享 mutex 的互斥（同一文件先 write_file 后 rawSet 串行化）

**验证**：`npm test --workspace=packages/core`

---

## Task 4: Core — DataStore 读入口 + mutate 执行器 + manifest 现场校验

**依赖**：T3。

**改动文件**：
- `packages/core/src/capabilities/data/data-store.ts` [扩充]：
  - `outline(file)`：锁外读 + version → 缓存命中返回 → miss 则 buildOutline
  - `read(file, opts)`：锁外读（version 快照）→ `ifVersion` 匹配则 `{ unchanged: true, version }` → `key` 参数为**字面顶层 key 查找**（SDK `data.get` 用，含点 key 不做 dot-path 解析，`$` 拒绝）→ `path` 为 dot-path 取值 → 数组默认切片 limit=20（返回 `total` + 翻页提示）→ `path: "."` 排除 `$` 键
  - `query(file, name, params, page)`：锁外读 → **现场校验** manifest 与路径（不信任缓存健康度）→ `runQuery`；stale/unknown 抛对应错误
  - `mutate(file, name, args, opts)`：幂等检查 → **锁内 load → 现场校验 → 四 op 执行**（append：fields 校验 + auto 补全 `uuid`/`nowIso`；update/remove：match 定位，未命中报错；set：整体替换字段）→ persist
  - 错误统一：`VersionConflictError`/`ManifestStaleError`/`UnknownEntryError`/validation 错误（含字段明细）
- 路径校验收敛：`packages/core/src/capabilities/data/path-guard.ts` [新增]——`resolveDataFile(root, file)`：`resolveProjectPath` + `.data.json` 后缀 + `.spherse/` 禁入（`.spherse/data/cards/` 例外），语义对齐 app 现有 `validateFileParam`，供 DataStore 内部与 T5 tool 复用

**测试**：
- read：无 path/key 返回 outline、`key` 字面查找（含点 key 不解析嵌套、`$` 拒绝）、`"."` 排除 `$`、局部读、数组默认切片 + total、ifVersion unchanged/冲突两态
- query：入口命中、未知入口报 validNames、stale 入口报错（外部 edit_file 改坏 path 后缓存仍 healthy 但执行报错的兜底场景）
- mutate：四 op 全矩阵（required/default/auto/enum 越界/match 未命中/identity 隐式 required）、幂等 key 端到端、事件 summary = 入口名
- `file_corrupted`：预置撕裂 JSON，read/query/mutate 报错不自动修复

**验证**：`npm test --workspace=packages/core`

---

## Task 5: Core — dataCapability + 3 tools + 装配

**依赖**：T4。

**改动文件**：
- `packages/core/src/capabilities/data/tools.ts` [新增]：`createReadDataTool`/`createQueryDataTool`/`createMutateDataTool`——工厂模式 `(dataStore, getPolicy)`；TypeBox 参数 schema；`read_data`/`query_data` 过 `assertRead`，`mutate_data` 过 `assertWrite`；错误转结构化文本 result（version conflict 提示携带当前 version 重读）
- `packages/core/src/capabilities/data/index.ts` [扩充]：`dataCapability(): Capability`——`tools(host)` 从 host 取共享 `DataStore` 实例（见装配）
- `packages/core/src/capabilities/builtin.ts` [修改]：注册 `dataCapability()`
- `packages/core/src/factory.ts` / `project-manager.ts` / `kernel/ports.ts` [修改]：`assembleProject` 创建单例 `DataStore`（传入共享 `fileWriteMutex`）挂到 host；对齐 `fsCapability` 的现有装配模式（参考 `shared-write-mutex.test.ts` 锁死共享实例）
- `packages/presets/templates/agent-template.md` [修改]：`tools:` 白名单加入 `read_data`/`query_data`/`mutate_data`（模板是显式清单，不加则存量 agent 看不到新工具）
- `packages/core/src/index.ts` [修改]：按 barrel 规范仅导出外部消费符号（server T6 需要的 `DataStore` 类型与错误类）

**测试**：
- 装配：host 上 DataStore 单例与 skill/fs 共享同一 mutex（扩展 `shared-write-mutex.test.ts` 模式）
- tool：policy deny（read/write 各一）、`.spherse` 拒绝、非 `.data.json` 拒绝、成功路径 result 含 version
- 默认 agent profile 是否暴露工具：确认 `tools:` 白名单机制对内置 capability 的作用方式，新工具默认启用（与 read_file 同级的基础能力）

**验证**：`npm test --workspace=packages/core && npm run build --workspace=packages/core`

---

## Task 6: Server — contracts + 3 routes

**依赖**：T5。

**改动文件**：
- `packages/core/src/capabilities/data/data-store.ts` 接口签名修正：`read(file, opts: { key?: string; path?: string; offset?: number; limit?: number; ifVersion?: string })`——`key`（字面顶层 key，SDK get 用）与 `path`（dot-path）互斥，同时给出报错
- `packages/server/src/contracts/data.ts` [新增]：`dataReadRequest/Response`、`dataRawSetRequest/Response`、`dataRawDeleteRequest/Response`（TypeBox；read 请求含 `key?`/`path?`；response 含 `version`/`unchanged?`/错误码枚举 `manifest_stale|version_conflict|validation_failed|file_corrupted|forbidden|not_found`）
- `packages/server/src/routes/data.ts` [新增]：`POST /api/projects/:projectId/data/read|raw-set|raw-delete`（**param 名对齐现有路由 `:projectId`**）——从 PM 取 `DataStore`，origin 固定 `"sdk"`；`VersionConflictError` → 409 + 当前 version；policy 错误 → 403；`$` key → 400
- `packages/server/src/contracts/index.ts`、`packages/server/src/routes/index.ts` [修改]：注册
- `packages/app/src/lib/api.ts` [修改]：`ApiClient.dataRead/dataRawSet/dataRawDelete`（复用 contracts parser，不裸 parse）

**测试**（server contract 测试目录）：
- schema 校验：缺字段 422、非法 file 形状 422
- 行为：read outline/局部读/unchanged、raw-set `.` 与 `$` key 拒绝、version_conflict 409 形状、`.spherse` 拒绝
- **契约测试（不 mock DataStore）**：真 ProjectManager 装配的端到端 route 测试至少一条（read + raw-set round-trip 落盘断言）

**验证**：`npm test --workspace=packages/server && npm run build --workspace=packages/server`

---

## Task 7: App — UI SDK data handler 迁移

**依赖**：T6。

**改动文件**：
- `packages/app/src/ui-sdk/handlers/data.ts` [修改]：五个 action 改为 ApiClient 新方法薄代理——`data.get` → `dataRead({ file, key })`（**字面 key 查找，非 dot-path**）；`data.keys`/`data.entries` → `dataRead({ file, path: "." })` 后派生；`data.set` → `dataRawSet`；`data.delete` → `dataRawDelete`；删除 renderer 端 `readDataJson`/`writeDataJson`/`MAX_FILE_SIZE`（上限移 server）；`$` key 前置拒绝（协议不变，响应用现有 `respond` 错误形态）
- postMessage 协议、iframe SDK bundle、rate-limit 白名单：**零变化**
- `packages/app/src/ui-sdk/handlers/data.test.ts` [修改]：mock ApiClient 断言代理行为与协议兼容（返回形状与旧实现一致）

**测试**：
- 协议兼容：get/keys/entries/set/delete 的 postMessage 响应形状与迁移前快照一致
- `$` key：set 返回 ok:false
- get 不存在 key → `null`（维持现状语义）

**验证**：`npm test --workspace=packages/app`

---

## Task 8: Presets — write-html / use-ui-sdk skill 更新

**依赖**：T2（manifest 语法定型）后任意时点；须在 T9 前完成。

**改动文件**：
- `packages/presets/skills/write-html/SKILL.md` [修改]：新增「数据文件嵌入 `$manifest`」一节——判据（会增长/需 agent 互动 → 必须）、三件套同源产出约束（mutations 必须覆盖页面 SDK 代码实际会做的结构性变更）、`$` 前缀保留键、manifest ≤2KB、完整 todos 模板（与 design §4.2 示例一致）、identity/match/auto 字段说明
- `packages/presets/skills/use-ui-sdk/SKILL.md` [修改]：`data.set/delete` 已原子的说明（页面无需防并发）、`$` key 保留、引导声明 manifest（链接 write-html）
- 同步检查 `create-skill` 等 skill 是否引用 data 文件约定（预计无，确认即可）

**验证**：`npm run build --workspace=packages/presets`（同步脚本跑通）+ 人工 review 文档示例与 T1 schema 一致

---

## Task 9: E2E + 全量验证

**依赖**：T5–T8 全部。

**改动文件**：
- `packages/desktop/e2e/data-json-selective.spec.ts` [新增]，覆盖 design §12 三场景：
  1. manifest 闭环：预置带 `$manifest` 的页面（todos 模板）→ 页面内 SDK set/delete（用户路径）→ 用 server API + core tool 路径模拟 agent2 `query_data`/`mutate_data` 互动（E2E 内经 debug/test hook 驱动，或按现有 E2E 对 agent tool 的驱动惯例）
  2. 并发无丢失：脚本并行发起 N 次 SDK set 与 M 次 mutate（不同 key/入口）→ 读回断言全部落盘
  3. 存量降级：无 manifest 大数组文件 → `read_data` outline + 分页局部读（断言不出现全量内容）

**验证**：
- `npm run verify`（lint + build + unit + i18n）
- `npm run test:e2e --workspace=packages/desktop -- e2e/data-json-selective.spec.ts`
- 收尾：`docs/dev/backlog.md` 条目 `[ ]` → `[x]`；检查 `docs/official/` 需同步项（工具清单、UI SDK data action 行为变化、架构图如列了 capabilities）
