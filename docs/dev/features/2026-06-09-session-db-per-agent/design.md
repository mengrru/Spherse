# Session DB Per Agent

## Background

当前所有 agent 的 session 数据存储在项目级共享的 `.spherse/sessions.db` SQLite 文件中。这导致：

- Agent 删除时需要额外的 archive 逻辑来处理 session 数据
- Session 数据与 agent 的文件组织不一致（agent 配置在 `agents/` 目录下，但 session 数据在外面）
- 无法通过删除 agent 目录来完整清理该 agent 的所有数据

## Goal

将 session DB 拆分为每个 agent 独享一个 SQLite 文件，放在该 agent 目录下。删除 agent 目录时 session 数据随目录一起删除，无需额外 cleanup。

## Constraints

- 项目未上线，不需要用户数据 migration
- 提供一个一次性 migration 脚本处理开发者本地测试数据
- 无跨 agent session 查询需求

## Design

### 1. DB 文件布局

**Before:**
```
.spherse/
  sessions.db              ← 所有 agent 共享
  agents/
    {slug}-{shortId}/
      profile.md
      theme.css
```

**After:**
```
.spherse/
  agents/
    {slug}-{shortId}/
      profile.md
      theme.css
      sessions.db          ← 该 agent 独享
```

每个 agent 目录下的 `sessions.db` 使用相同的 schema：

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,    -- 保留，冗余但便于调试
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
```

### 2. SessionStore 改造

`SessionStore` 从管理单个 DB 连接改为管理按 agent 区分的连接池。

**构造函数变更：**

```ts
// Before
new SessionStore(logger?)
await sessionStore.init(dbPath)

// After
new SessionStore(agentsDir, logger?)
```

接收 `agentsDir`（即 `.spherse/agents/`），不再需要 `init()`。

**内部状态：**

```ts
private agentsDir: string;
private connections: Map<string, Database> = new Map();  // agentId → db
private dirCache: Map<string, string> = new Map();       // agentId → agentDir path
```

**Lazy open 策略：**

```ts
private getDb(agentId: string): Database {
  let db = this.connections.get(agentId);
  if (db) return db;

  const agentDir = this.findAgentDir(agentId);
  const dbPath = path.join(agentDir, "sessions.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(MIGRATION);
  this.connections.set(agentId, db);
  return db;
}
```

`findAgentDir` 通过读取各子目录的 `profile.md` frontmatter 找到 `id === agentId` 的目录。结果缓存在 `dirCache` 中，`closeAgent` 时一并清理。

**方法签名变更：**

| Before | After | 说明 |
|--------|-------|------|
| `init(dbPath)` | 移除 | 构造函数接收 agentsDir |
| `close()` | `close()` | 关闭所有已打开的 DB 连接 |
| - | `closeAgent(agentId)` | 关闭指定 agent 的连接并清理 dirCache，agent 删除时调用 |
| `createSession(agentId, title?)` | `createSession(agentId, title?)` | 不变，内部用 agentId 路由到正确 DB |
| `getSession(sessionId)` | `getSession(agentId, sessionId)` | 增加 agentId 参数 |
| `listSessions(agentId?)` | `listSessions(agentId)` | agentId 必填，每个 DB 只有一个 agent 的数据 |
| `archiveByAgentId(agentId)` | 移除 | 不再需要 |
| `archiveSession(sessionId)` | `archiveSession(agentId, sessionId)` | 增加 agentId 参数 |
| `appendMessage(sessionId, msg)` | `appendMessage(agentId, sessionId, msg)` | 增加 agentId 参数，包在 db.transaction() 中 |
| `getSessionMessages(sessionId)` | `getSessionMessages(agentId, sessionId)` | 增加 agentId 参数 |
| `updateSessionTitle(sessionId, title)` | `updateSessionTitle(agentId, sessionId, title)` | 增加 agentId 参数 |

### 3. Engine 层适配

Engine 的公开接口调整，所有 session 相关方法需要 `agentId` 参数。`activeSessions` 从 `Map<sessionId, Agent>` 改为 `Map<sessionId, { agent, agentId }>`，`sendMessage` 从 entry 中直接取 `agentId`，无需额外查找。

```ts
// Before
getSession(sessionId): SessionInfo | null
listSessions(agentId?: string): SessionInfo[]
createSession(agentId): Promise<string>
restoreSession(sessionId): Promise<string>
sendMessage(sessionId, message, onEvent): Promise<void>
deleteSession(sessionId): void
getSessionHistory(sessionId): any[]

// After
getSession(agentId, sessionId): SessionInfo | null
listSessions(agentId): SessionInfo[]
createSession(agentId): Promise<string>            // 不变
restoreSession(agentId, sessionId): Promise<string>
sendMessage(sessionId, message, onEvent): Promise<void>  // agentId 从 activeSessions entry 取
deleteSession(agentId, sessionId): void
getSessionHistory(agentId, sessionId): any[]
renameSession(agentId, sessionId, title): SessionInfo
```

`deleteProfile(agentId)` 简化：不再需要 `archiveByAgentId`，只需关闭该 agent 的 DB 连接后删除目录：

```ts
async deleteProfile(agentId: string): Promise<void> {
  const sessions = this.sessionStore.listSessions(agentId);
  for (const session of sessions) {
    this.activeSessions.delete(session.id);
  }
  this.sessionStore.closeAgent(agentId);
  await this.profileStore.delete(agentId);  // 目录整体删除，包含 sessions.db
}
```

### 4. Server API 变更

RESTful 路径从 `/api/sessions` 改为 `/api/agents/:agentId/sessions`：

| Before | After | 说明 |
|--------|-------|------|
| `GET /api/sessions?agentId=...` | `GET /api/agents/:agentId/sessions` | agentId 从 query 移到路径 |
| `POST /api/sessions` body: `{agentId}` | `POST /api/agents/:agentId/sessions` | agentId 从 body 移到路径 |
| `GET /api/sessions/:id` | `GET /api/agents/:agentId/sessions/:sessionId` | 完整路径 |
| `GET /api/sessions/:id/messages` | `GET /api/agents/:agentId/sessions/:sessionId/messages` | 完整路径 |
| `PATCH /api/sessions/:id` | `PATCH /api/agents/:agentId/sessions/:sessionId` | 完整路径 |
| `DELETE /api/sessions/:id` | `DELETE /api/agents/:agentId/sessions/:sessionId` | 完整路径 |

WebSocket 从 `/ws/chat/:sessionId` 改为 `/ws/chat/:agentId/:sessionId`，前端在建立连接时直接传入 `agentId`（Chat 组件已有 `agent.id`）。`sendMessage` 和 `abortSession` 仍只接收 `sessionId`（通过内存中的 `activeSessions` 取 agent）。

### 5. API Contracts 更新

`@spherse/server/contracts` 中相关 schema 更新：
- `createSessionRequest` 移除 `agentId` 字段（从 URL 获取）
- 路由参数校验使用路径中的 `:agentId`

### 6. 前端适配

前端 `project-data-store` 和相关 API client 需要调整：
- 所有 session API 调用路径加上 `/agents/:agentId` 前缀
- `refreshSessions` 改为遍历 agents 列表逐个调用 `listSessions(agent.id)` 后聚合
- `deleteSession`/`renameSession` 从 store 中的 session 数据查找 `agentId` 传入
- `deleteAgent` 改为先 `refreshAgents` 再 `refreshSessions`（顺序依赖）
- `streaming-store` 的 `connect`/`attach` 增加 `agentId` 参数，用于 WebSocket URL 和 `getSessionMessages`

### 7. 本地数据迁移脚本

Shell 脚本 `scripts/migrate-session-db.sh`（使用系统 `sqlite3` CLI，避免 native module 版本问题）：

1. 接收项目根目录作为参数
2. 打开 `.spherse/sessions.db`
3. `SELECT DISTINCT agent_id FROM sessions`
4. 对每个 agent_id：
   - 扫描 `.spherse/agents/` 找到匹配的 agent 目录（通过 `profile.md` 的 `id` 字段）
   - 在该目录下创建 `sessions.db`（schema + `ATTACH DATABASE` 批量复制）
   - 复制该 agent 的 sessions 和 messages 数据
5. 备份旧的 `sessions.db` 为 `sessions.db.bak`

### 8. 测试覆盖

- `packages/core/src/__tests__/store/session.test.ts` 适配新的 SessionStore 接口
- 新增 lazy open 测试（首次访问创建 DB，后续复用连接）
- 新增 `closeAgent` 测试
- 多 agent 隔离测试（一个 agent 的 session 对另一个 agent 不可见）
- Server route 测试适配新路径
- 前端 store 测试更新 mock 签名（`listSessions`、`deleteSession`、`renameSession` 加 agentId）
- E2E 测试更新硬编码 API URL

## Impact Summary

| 层 | 改动范围 |
|----|----------|
| `@spherse/core` SessionStore | 重写连接管理，方法签名变更 |
| `@spherse/core` Engine | `activeSessions` 存 `{agent, agentId}`，透传 agentId 给 SessionStore |
| `@spherse/core` factory | SessionStore 构造方式变更 |
| `@spherse/server` routes | 路径从 `/api/sessions` 改为 `/api/agents/:agentId/sessions`，WS 加 agentId |
| `@spherse/server` contracts | request schema 移除 agentId 字段 |
| `@spherse/app` API client | 调用路径适配 |
| `@spherse/app` store | `refreshSessions` 改为 per-agent 聚合，透传 agentId |
| `@spherse/app` streaming-store | `attach`/`connect` 增加 agentId，WS URL 含 agentId |
| Migration script | 新增 shell 脚本 |
