# Design: 存储层端口抽象（P1 store 先行）

- 日期：2026-11-22
- 状态：reviewed（3C/4I/4M/4m 已处理，见文末处理记录）
- 关联：`docs/dev/infra/2026-11-21-plugin-runtime-rpc/design.md`（P1、D2/D3、O3 已拍板 cordis 4.x）；事实基础：`docs/dev/investigation/2026-11-22-storage-inventory/README.md`；OPFS 约束实测：`docs/dev/investigation/2026-11-22-browser-matrix/README.md`

## 1. 目标与非目标

**目标**：为 browser 版（SharedWorker + OPFS/IndexedDB）建立存储接缝——把存储访问抽象为端口，桌面（Node/SQLite/fs）实现迁移到端口后，**桌面行为零变化**；端口语义内化 OPFS/IndexedDB 约束，保证 P3 实现时接口不返工。

**非目标**：
- 不实现 browser 版存储（P3）
- 不动 model-settings / electron-store（D6 平台插件归属，随 BackendPort 不动原则）
- 不动 marketplace zip 安装链与 SkillStore 安装 staging（`os.tmpdir()`，在 port root 之外，相对路径契约无法表达；browser 版安装来源随 R5 在 P3 重定义）
- **server RPC 读面直连 fs（盘点 R4：`rpc/methods/content.ts`、`settings.ts` theme 直读）不在本设计收口**——收口归 P1 插件化阶段（方法组复用 FsPort 语义使 P3 browser 方法组可平移），届时评估是否需要部分读原语（content.ts 头采样判二进制只读前 N 字节）
- 不引入 cordis（本设计是 P1「store 先行」的纯 TS 部分；host 落地时以薄 service 桥接，见 §5）

## 2. 端口划分：两种粒度并存（决策 D-S1）

| 存储 | 粒度 | 端口 | 理由 |
|---|---|---|---|
| sessions.db | **语义级** | `SessionStorePort` | 结构化存储；IDB 天然承接语义方法（对象存储+索引），SQL 是 Node 实现私有细节 |
| memory.db entries | **语义级** | `MemoryStorePort` | 同上（FTS5 检索是 Node 实现增强，接口契约只定义匹配语义） |
| `.spherse/` 文件树、`*.data.json`、attachments、memory/core.md（含串行写链）、文件工具族读写 | **原语级** | `FsPort` | 非结构化文件族共享同一套 fs 原语；OPFS 直接对应；各业务 store 保留语义、只换底层原语 |

memory 域横跨两粒度，明确拆分：`MemoryStore` 的 entries/db 面（`memory.ts` FTS5 部分）走 `MemoryStorePort`；`core.md` 的 RMW 与串行写链（`memory.ts:178-219`）属文件域，改走 `FsPort`（browser 实现内部落 OPFS）。

不选全原语（session 走 IDB 无文件概念）也不选全语义（每类文件 store 写两遍端口，原语重复定义）。

## 3. 端口定义

### 3.1 FsPort（原语级，绑定根的相对路径）

```ts
export interface FsEntry { name: string; isDirectory: boolean }
export interface FsStat { isFile: boolean; isDirectory: boolean; size: number; mtime: number; id?: string }

export interface FsPort {
  capabilities: { atomicRename: boolean; watch: boolean };
  readFile(relPath: string): Promise<string>;
  readBinaryFile(relPath: string): Promise<Uint8Array>;
  writeFile(relPath: string, content: string): Promise<void>;           // in-place 写（见契约注 1）
  writeBinaryFile(relPath: string, data: Uint8Array): Promise<void>;    // in-place 写
  writeFileIfMissing(relPath: string, content: string): Promise<boolean>; // 存在则不写，返回是否写入（wx 语义）
  appendFile(relPath: string, content: string): Promise<void>;          // 追加写（CHANGELOG / jsonl 轮转）
  mkdirp(relPath: string): Promise<void>;
  readdir(relPath: string): Promise<FsEntry[]>;
  stat(relPath: string): Promise<FsStat | null>;                        // null = 不存在
  unlink(relPath: string): Promise<void>;                               // 幂等：不存在时 no-op（见契约注 3）
  rm(relPath: string, options: { recursive: boolean }): Promise<void>;   // 文件或目录；幂等
  rename(from: string, to: string): Promise<void>;                      // 文件或目录；capability=atomicRename 时原子，否则 copy+delete 降级（复用 fs-move util 形态）
  copyFile(from: string, to: string): Promise<void>;
  copyTree(from: string, to: string): Promise<void>;                    // move/skill 安装的递归拷贝
  watch?(relPath: string, onChange: (event: FsWatchEvent) => void): () => void;
}
export type FsWatchEvent = { relPath: string; kind: "add" | "change" | "unlink" };
export function createNodeFsPort(projectRoot: string): FsPort;          // 默认实现
```

**契约注**：

1. **writeFile/writeBinaryFile 是 in-place 写**，不承诺崩溃原子性——对齐现状（除 DataStore 外全部裸写，见盘点）。并发安全由上层 `FileWriteMutex` 单实例保证（见注 4）；需要原子可见的数据路径（DataStore）在 FsPort 之上自行组合 `writeFile(tmp) + rename`（现状即此形态）。副作用：Node 实现 inode/chmod 不变、watch 事件归类不变——这是「桌面行为零变化」的直接推论。browser 实现内部（IDB 事务/OPFS 单写者）天然获得原子性，是实现红利而非契约义务。
2. **相对路径契约**：port 实例绑定 `projectRoot`，接口只接受 posix 风格项目内相对路径（OPFS 无绝对路径概念）。`resolveProjectPath` / `assertInsideProject` 校验保留在 PM 门面（红线不动）。实现必须拒绝 `..` 逃逸与绝对路径；**无 symlink 支持**（Node 实现对 symlink 按 Dirent 语义平移：isDirectory=false；OPFS 无 symlink）。
3. **删除幂等**：`unlink`/`rm` 对不存在路径 no-op——「不存在」错误由消费方前置 `stat` 提供（PM 现状即先 stat 后删）；统一现状中 TriggerStore try/catch 吞缺失与 PM 显式检查两种风格为幂等语义。
4. **FileWriteMutex 承重前提**（I4 固化）：DataStore 的 `ifVersion` 乐观锁 = mutex 内 RMW（`data-store.ts:165-174`），序列化完全依赖 **FileWriteMutex 单实例贯穿 PM/DataStore/AgentStore/SkillStore 且 key 归一化**（迁移后 key 从 absPath 统一为 relPath，实例唯一性由 createProject 装配保证）。browser 单 SharedWorker 下进程内 mutex 语义不变（browser-matrix 单写者结论）。
5. **capability 探测代替运行时分支**：`atomicRename=false` 时 rename 允许 copy+delete 降级（Firefox `move()` 缺失，R2）；`watch=false` 时 bus fs-watch 通道降级（R1）。消费方按 capabilities 走降级路径。
6. **watch 契约**：recursive 目录语义（现状 `fs.watch(root,{recursive:true})`）；port 事件词汇 `add/change/unlink` 是 core 内部词汇，**core 内完成到 bus 线词汇（rename/change）的映射，bus 线格式不变**；watch 能力经 ProjectRuntime 暴露给 server 消费（fs-watcher 模块改走 port，接口挂 ProjectRuntime 而非 PM）。
7. **FsStat.id**：Node 实现为 `dev:ino` 组合（PM.renamePath 的「仅大小写重命名」检测 `project-manager.ts:453-457` 依赖同实体标识）；browser 实现提供任意稳定实体 id（OPFS 文件无 inode，可退化为路径+创建时间或省略——大小写重命名检测在 id 缺失时退化为字符串不等判断，macOS/Windows 大小写场景损失精度，记录为已知降级）。

### 3.2 SessionStorePort（语义级）

现有 `SessionStore` 类的公共方法面即端口，**全量清单**（`store/session.ts`）：createSession / getSession / listSessions / listSessionsPage / updateSessionTitle（注意：不是 renameSession，`session.ts:550-555`）/ archiveSession / appendEvents / readEvents / readEventsAfter / readEventCount / maxSeq / searchMessages + **legacy 读组**：getSessionMessages / getSessionMessagesWithIds / getMessagesAfter / getLatestCompaction / getRecentMessages（`session.ts:432-548`，PM legacy 读路径消费）+ **legacy 迁移组**：migrateEvents / isMigrated / sessionNeedsMigration。

类型上抽 `SessionStorePort` interface，`SessionStore` 改名 `SqliteSessionStore implements SessionStorePort`；注入链 `createProject → ProjectStore → AgentStore`（AgentStore 两处构造点 `project.ts:124/198` 传参）→ `sessions` getter（`agent-store.ts:101-111`）取 factory。

**接口契约（跨实现必须成立，写进契约测试）**：

- `appendEvents`：批内原子；seq 必须等于该 session 当前 `maxSeq+1` 起且批内连续（违反即抛；落库失败内存回滚语义由上层 `SessionEventLog` 保留）；同批更新 session 的 updated_at。IDB 映射：同 object-store 事务。
- `readEventsAfter(since)`：严格大于 since，按 seq 升序。
- legacy 读组与迁移组**留在接口**：迁移属于「已发布数据兼容」红线范畴，语义上属于读面兼容；browser 实现读组返回空、迁移组返回 no-op/false——避免 PM 消费点类型分支。
- `searchMessages`：契约为 **ASCII 大小写不敏感子串匹配、非 ASCII 精确匹配**（对齐 SQLite LIKE 现状，M2）。

### 3.3 MemoryStorePort（语义级）

`MemoryStore` 的 entries/db 公共方法抽接口（不含 core.md 面，见 §2 拆分），`SqliteMemoryStore implements MemoryStorePort`。检索契约：ASCII-ci 子串匹配、非 ASCII 精确（LIKE 兜底路径语义）；**排序显式声明为实现细节**（现状 FTS5 bm25 与 LIKE updated_at DESC 两条路径本就不一致，M2），契约测试只固定「命中集合」不固定顺序。

## 4. 注入形态：两步走（决策 D-S2）

- **步骤 1（本设计交付）**：构造注入。`createProject(options)` 增加可选 `storage?: { fsPort?: FsPort; sessionStoreFactory?: (agentSlug: string) => SessionStorePort; memoryStoreFactory?: (agentSlug: string) => MemoryStorePort }`，缺省全部 Node 实现——桌面调用方零改动。
- **步骤 2（P1 cordis host 落地时）**：以 cordis service 包装（`ctx.provide("spherse/fs")` 等），service 内部持有步骤 1 的工厂；业务插件从 ctx 注入。桥层预期 <100 行，不提前实现。

理由：先冻结接口与语义（本设计的核心资产），注册机制随 cordis 4.x Fiber/service API 落地时一次对齐，避免 rc API 变动波及接口设计。

## 5. 实施阶段与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| 1a | SessionStore/MemoryStore 接口化 + 工厂注入链（createProject→ProjectStore→AgentStore） | 全量 verify；现有 core/server 测试零改动通过（改名处 re-export 兼容）；端口契约测试套（跑在 Sqlite 实现上） |
| 1b | FsPort + 相对路径迁移，范围见 §6 范围表 in 项 | 同上 + e2e 桌面回归（agent-dialog/rpc/content 相关场景） |
| 1c | watch capability：core 内事件词汇映射（bus 线格式不变）+ capabilities.watch=false 的 bus fs-watch 降级路径 | 契约测试先固定事件归类再改实现；单测覆盖降级分支 |

端口契约测试是 P3 的直接资产：IDB/OPFS 实现跑同一套契约测试即视为存储层等价（repo 红线：跨层接缝契约测试）。

## 6. 迁移范围表（I1）

core 内 node:fs 消费文件共 20 个（非 test），逐项归属：

| 模块 | 归属 |
|---|---|
| store/project.ts、agent-store.ts、agent-profile.ts、mcp-config.ts、project-config.ts | **in 1b** |
| store/trigger.ts（TriggerStore：profile/logs.jsonl 追加与轮转） | **in 1b** |
| capabilities/data/data-store.ts | **in 1b**（含 sha256 见风险表） |
| capabilities/write（read/write/edit/list/move/copy/search-content/render-card 文件工具族）、read-context-files、generate-image、image-processor | **in 1b**（agent 工具链 browser 版必须可用） |
| store/memory.ts core.md 部分 | **in 1b**（走 FsPort，见 §2 拆分） |
| store/skill.ts **读面**（skill 目录在项目树内） | **in 1b** |
| store/skill.ts **安装链**（os.tmpdir staging）、store/marketplace-project.ts、presets 内置注入 | **out**（Node-only；browser 安装来源 P3 重定义） |
| util fs-move.ts | **in 1b**（rename 降级 util 形态复用） |
| server 侧（content/settings RPC 读面、marketplace、preview、model-settings） | **out**（见 §1 非目标，P1 插件化阶段收口） |

## 7. 风险表

| 风险 | 缓解 |
|---|---|
| 1b 波及面大（20 文件 `path.join` 调用点 + mutex key 从 absPath 归一为 relPath） | 按 store 文件逐个迁移；mutex key 归一化作为独立 commit 先行（全量测试锁定行为）；`resolveProjectPath` 门面不动 |
| FileWriteMutex 实例唯一性被破坏 → ifVersion 防线出现并发窗口 | createProject 装配断言（单例注入断言测试） |
| `node:crypto` sha256 是同步 API，browser 需 `crypto.subtle.digest`（异步）或 JS 实现（M3） | data-store 迁移时抽 `sha256Hex` util（签名同步/异步二选一，倾向统一 async）；列 1b 任务 |
| attachments ≤100MB 上传：writeBinaryFile in-place 保持现状（无 tmp 双倍 IO/双事件） | 契约注 1 的直接推论；不引入大文件特殊路径 |
| FTS5/LIKE 检索语义差异导致桌面行为变化 | 契约测试用 ASCII/非 ASCII/大小写边界样例固定「命中集合」语义（顺序除外） |
| watch 事件归类漂移（M1） | 1c 先写契约测试固定归类，core 内映射 bus 词汇，线格式不变 |
| IDB 事务粒度与「append + updated_at 同批」语义映射 | 契约测试以失败注入验证原子性（第二批失败时第一批不可见） |
| core.md 串行写链拆分后丢失串行保证 | core.md 归 FsPort 侧但串行链留在 Memory 门面层（迁移时保持调用序） |

## Review 处理记录（2026-11-22）

- **C1**：修正原子性断言——writeFile 契约改为 in-place（对齐现状裸写），DataStore 原子性由其在 port 之上自行组合；watch 归类不变因此 1c 无需前移。✅
- **C2**：补 legacy 读组 5 方法；renameSession 更正为 updateSessionTitle；风险表相应行删除。✅
- **C3**：补 appendFile / rm(recursive) / copyFile / copyTree / writeFileIfMissing(wx) 原语；rename 声明支持目录；FsStat.id（dev:ino）支持大小写重命名检测。✅
- **I1**：新增 §6 逐模块范围表；SkillStore 读面 in、安装链 out。✅
- **I2**：非目标明确 R4 收口归属 P1 插件化阶段 + 部分读原语评估。✅
- **I3**：memory 域拆分明确（core.md → FsPort，entries → MemoryStorePort），§2/§3.3 一致化。✅
- **I4**：契约注 4 固化 FileWriteMutex 承重前提。✅
- **M1-M4 / m1-m4**：watch recursive+词汇映射+ProjectRuntime 挂载（注 6）；检索措辞收敛 ASCII-ci（§3.2/3.3）；sha256 风险行；unlink/rm 幂等契约（注 3）；注入链写全（§3.2）；rename 降级复用 fs-move（注 5）；symlink 无支持（注 2）；FsStat.id 降级已知化（注 7）。✅
