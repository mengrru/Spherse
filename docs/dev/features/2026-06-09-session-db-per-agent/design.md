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
```

**Lazy open 策略：**

```ts
private getDb(agentId: string): Database {
  let db = this.connections.get(agentId);
  if (db) return db;

  // 扫描 agentsDir 查找包含该 agentId 的目录
  const agentDir = this.findAgentDir(agentId);
  const dbPath = path.join(agentDir, "sessions.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(MIGRATION);
  this.connections.set(agentId, db);
  return db;
}
```

`findAgentDir` 通过读取各子目录的 `profile.md` frontmatter 找到 `id === agentId` 的目录。为避免频繁扫描，可增加 `Map<agentId, dirName>` 缓存。

**方法签名变更：**

| Before | After | 说明 |
|--------|-------|------|
| `init(dbPath)` | 移除 | 构造函数接收 agentsDir |
| `close()` | `close()` | 关闭所有已打开的 DB 连接 |
| - | `closeAgent(agentId)` | 关闭指定 agent 的连接，agent 删除时调用 |
| `createSession(agentId, title?)` | `createSession(agentId, title?)` | 不变，内部用 agentId 路由到正确 DB |
| `getSession(sessionId)` | `getSession(agentId, sessionId)` | 增加 agentId 参数 |
| `listSessions(agentId?)` | `listSessions(agentId)` | agentId 必填，每个 DB 只有一个 agent 的数据 |
| `archiveByAgentId(agentId)` | 移除 | 不再需要 |
| `archiveSession(sessionId)` | `archiveSession(agentId, sessionId)` | 增加 agentId 参数 |
| `appendMessage(sessionId, msg)` | `appendMessage(agentId, sessionId, msg)` | 增加 agentId 参数 |
| `getSessionMessages(sessionId)` | `getSessionMessages(agentId, sessionId)` | 增加 agentId 参数 |
| `updateSessionTitle(sessionId, title)` | `updateSessionTitle(agentId, sessionId, title)` | 增加 agentId 参数 |
| - | `findSessionOwner(sessionId)` | 遍历已打开的 DB 查找 session 所属 agentId（冷启动边缘路径） |

### 3. Engine 层适配

Engine 的公开接口调整，所有 session 相关方法需要 `agentId` 参数：

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
sendMessage(agentId, sessionId, message, onEvent): Promise<void>
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

WebSocket `/ws/chat/:sessionId` 保持不变。`restoreSession` 在 ws-chat 连接时调用。由于 Engine 维护了 `activeSessions` Map（sessionId → Agent），可以从 active session 中获取 agentId。若 session 不在内存中（首次连接），则需要一个 sessionId → agentId 的查找机制：

- 方案：Engine 增加一个 `Map<sessionId, agentId>` 缓存（`sessionAgentMap`），`createSession` 时写入。`restoreSession` 若在 `sessionAgentMap` 中未命中，则通过 SessionStore 的 `findSessionOwner(sessionId)` 方法遍历已打开的 DB 查找（边缘路径，仅冷启动时触发）。

### 5. API Contracts 更新

`@spherse/server/contracts` 中相关 schema 更新：
- `createSessionRequest` 移除 `agentId` 字段（从 URL 获取）
- 路由参数校验使用路径中的 `:agentId`

### 6. 前端适配

前端 `project-data-store` 和相关 API client 需要调整：
- 所有 session API 调用路径加上 `/agents/:agentId` 前缀
- 当前已选中的 agentId 可从 store 中获取，无需额外传递

### 7. 本地数据迁移脚本

一个独立的 Node.js 脚本 `scripts/migrate-session-db.ts`（或放在 `packages/core/scripts/` 下）：

1. 接收项目根目录作为参数
2. 打开 `.spherse/sessions.db`
3. `SELECT DISTINCT agent_id FROM sessions`
4. 对每个 agent_id：
   - 扫描 `.spherse/agents/` 找到匹配的 agent 目录
   - 在该目录下创建 `sessions.db`
   - 复制该 agent 的 sessions 和 messages 数据
5. 备份旧的 `sessions.db` 为 `sessions.db.bak`
6. 删除旧的 `sessions.db`

### 8. 测试覆盖

- `packages/core/src/__tests__/store/session.test.ts` 适配新的 SessionStore 接口
- 新增 lazy open 测试（首次访问创建 DB，后续复用连接）
- 新增 `closeAgent` 测试
- 多 agent 隔离测试（一个 agent 的 session 对另一个 agent 不可见）
- Server route 测试适配新路径

## Impact Summary

| 层 | 改动范围 |
|----|----------|
| `@spherse/core` SessionStore | 重写连接管理，方法签名变更 |
| `@spherse/core` Engine | 透传 agentId 给 SessionStore |
| `@spherse/core` factory | SessionStore 构造方式变更 |
| `@spherse/server` routes | 路径从 `/api/sessions` 改为 `/api/agents/:agentId/sessions` |
| `@spherse/server` contracts | request schema 移除 agentId 字段 |
| `@spherse/app` API client | 调用路径适配 |
| `@spherse/app` store | 透传 agentId |
| Migration script | 新增一次性脚本 |
