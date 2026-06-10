# Session DB Per Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 session SQLite DB 从项目级共享文件拆分为每个 agent 目录下的独立文件。

**Architecture:** SessionStore 改为管理 `Map<agentId, Database>` 连接池，lazy open。Server API 路径从 `/api/sessions` 改为 `/api/agents/:agentId/sessions`。Engine 维护 `sessionAgentMap` 处理 ws-chat 冷启动查找。

**Tech Stack:** better-sqlite3, Fastify, React/Zustand, TypeScript

**Design doc:** `docs/dev/features/2026-06-09-session-db-per-agent/design.md`

---

### Task 1: Rewrite SessionStore

**Files:**
- Modify: `packages/core/src/store/session.ts`

SessionStore 从管理单个 DB 连接改为按 agentId 管理连接池。

- [ ] **Step 1: Rewrite SessionStore with connection pool**

```ts
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { SessionInfo } from "../types.js";
import type { Logger } from "../logger.js";
import pino from "pino";

const MIGRATION = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
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
`;

export class SessionStore {
  private agentsDir: string;
  private connections: Map<string, Database.Database> = new Map();
  private dirCache: Map<string, string> = new Map();
  private logger: Logger;

  constructor(agentsDir: string, logger?: Logger) {
    this.agentsDir = agentsDir;
    this.logger = logger ?? pino({ level: "silent" });
  }

  close(): void {
    for (const db of this.connections.values()) {
      db.close();
    }
    this.connections.clear();
    this.dirCache.clear();
  }

  closeAgent(agentId: string): void {
    const db = this.connections.get(agentId);
    if (db) {
      db.close();
      this.connections.delete(agentId);
    }
  }

  private findAgentDir(agentId: string): string {
    const cached = this.dirCache.get(agentId);
    if (cached) return cached;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.agentsDir, { withFileTypes: true });
    } catch {
      throw new Error(`agents directory not found: ${this.agentsDir}`);
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const profilePath = path.join(this.agentsDir, entry.name, "profile.md");
      try {
        const raw = fs.readFileSync(profilePath, "utf-8");
        const { data } = matter(raw);
        if (data.id === agentId) {
          const fullPath = path.join(this.agentsDir, entry.name);
          this.dirCache.set(agentId, fullPath);
          return fullPath;
        }
      } catch {
        continue;
      }
    }

    throw new Error(`agent directory not found for agentId: ${agentId}`);
  }

  private getDb(agentId: string): Database.Database {
    let db = this.connections.get(agentId);
    if (db) return db;

    const agentDir = this.findAgentDir(agentId);
    const dbPath = path.join(agentDir, "sessions.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(MIGRATION);
    this.connections.set(agentId, db);
    this.logger.info({ agentId, dbPath }, "session db opened");
    return db;
  }

  createSession(agentId: string, title?: string): string {
    const db = this.getDb(agentId);
    const id = crypto.randomUUID();
    const now = Date.now();
    db.prepare(
      "INSERT INTO sessions (id, agent_id, title, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, 'active')",
    ).run(id, agentId, title ?? null, now, now);
    this.logger.info({ sessionId: id, agentId }, "session created in store");
    return id;
  }

  getSession(agentId: string, sessionId: string): SessionInfo | null {
    const db = this.getDb(agentId);
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as any;
    if (!row) return null;
    return {
      id: row.id,
      agentId: row.agent_id,
      title: row.title ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status,
    };
  }

  listSessions(agentId: string): SessionInfo[] {
    const db = this.getDb(agentId);
    const rows = db.prepare(
      "SELECT * FROM sessions WHERE status = 'active' ORDER BY updated_at DESC",
    ).all() as any[];
    return rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      title: row.title ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status,
    }));
  }

  archiveSession(agentId: string, sessionId: string): void {
    const db = this.getDb(agentId);
    db.prepare("UPDATE sessions SET status = 'archived' WHERE id = ?").run(sessionId);
  }

  appendMessage(agentId: string, sessionId: string, message: any): void {
    const db = this.getDb(agentId);
    const now = Date.now();
    db.prepare(
      "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
    ).run(sessionId, message.role, JSON.stringify(message), message.timestamp ?? now);
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sessionId);
    this.logger.debug({ sessionId }, "message persisted");
  }

  getSessionMessages(agentId: string, sessionId: string): any[] {
    const db = this.getDb(agentId);
    const rows = db.prepare(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC",
    ).all(sessionId) as any[];
    return rows.map((row) => JSON.parse(row.content));
  }

  updateSessionTitle(agentId: string, sessionId: string, title: string): void {
    const db = this.getDb(agentId);
    db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(title, sessionId);
  }

  findSessionOwner(sessionId: string): string | null {
    for (const [agentId, db] of this.connections) {
      const row = db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId) as any;
      if (row) return agentId;
    }
    return null;
  }
}
```

Key changes from original:
- Constructor takes `agentsDir` instead of `logger`+`init(dbPath)`
- Internal `connections` Map for connection pool, `dirCache` for agent directory lookup
- `findAgentDir` scans agent directories by reading `profile.md` frontmatter
- `getDb(agentId)` lazy opens DB files
- All methods take `agentId` as first parameter
- `archiveByAgentId` removed
- `findSessionOwner(sessionId)` added for ws-chat cold-start
- No more `async init()` — construction is sufficient

- [ ] **Step 2: Verify the file compiles**

Run: `npm run build --workspace=packages/core`
Expected: compiles with no errors (Engine/Factory will be broken, fixed in Task 2)

---

### Task 2: Update Engine

**Files:**
- Modify: `packages/core/src/engine.ts`

Engine 需要在所有 session 方法中传入 agentId，并维护 `sessionAgentMap`。

- [ ] **Step 1: Add sessionAgentMap and update all session methods**

Add a new field and update all session-related methods in the `Engine` class:

```ts
private sessionAgentMap: Map<string, string> = new Map();
```

Update each method:

```ts
getSession(agentId: string, sessionId: string): SessionInfo | null {
  return this.sessionStore.getSession(agentId, sessionId);
}

listSessions(agentId: string): SessionInfo[] {
  return this.sessionStore.listSessions(agentId);
}

async createSession(agentId: string): Promise<string> {
  const profile = await this.profileStore.getById(agentId);
  if (!profile) throw new Error(`Agent profile "${agentId}" not found`);

  const sessionId = this.sessionStore.createSession(agentId);
  const agent = await this.buildAgent(profile, sessionId);
  this.activeSessions.set(sessionId, agent);
  this.sessionAgentMap.set(sessionId, agentId);
  this.logger.info({ sessionId, agentId }, "session created");
  return sessionId;
}

async restoreSession(agentId: string, sessionId: string): Promise<string> {
  if (this.activeSessions.has(sessionId)) return sessionId;

  const session = this.sessionStore.getSession(agentId, sessionId);
  if (!session) throw new Error(`Session "${sessionId}" not found`);

  const profile = await this.profileStore.getById(session.agentId);
  if (!profile)
    throw new Error(`Agent profile for session "${sessionId}" not found`);

  const agent = await this.buildAgent(profile, sessionId);
  agent.state.messages = this.sessionStore.getSessionMessages(agentId, sessionId);
  this.activeSessions.set(sessionId, agent);
  this.sessionAgentMap.set(sessionId, agentId);
  this.logger.info({ sessionId }, "session restored");
  return sessionId;
}

async sendMessage(
  sessionId: string,
  message: string,
  onEvent: AgentEventHandler,
): Promise<void> {
  const agent = this.activeSessions.get(sessionId);
  if (!agent) throw new Error(`No active session "${sessionId}"`);

  const agentId = this.sessionAgentMap.get(sessionId);
  if (!agentId) throw new Error(`No agentId for session "${sessionId}"`);

  const sessionLogger = this.logger.child({ sessionId });

  const unsubscribe = agent.subscribe((event) => {
    logAgentEvent(sessionLogger, event);
    onEvent(event);
    if (event.type === "message_end") {
      this.sessionStore.appendMessage(agentId, sessionId, event.message);
    }
  });

  try {
    await agent.prompt(message);
  } finally {
    unsubscribe();
  }
}

destroySession(sessionId: string): void {
  this.activeSessions.delete(sessionId);
  this.sessionAgentMap.delete(sessionId);
}

deleteSession(agentId: string, sessionId: string): void {
  this.activeSessions.delete(sessionId);
  this.sessionAgentMap.delete(sessionId);
  this.sessionStore.archiveSession(agentId, sessionId);
}

getSessionHistory(agentId: string, sessionId: string): any[] {
  return this.sessionStore.getSessionMessages(agentId, sessionId);
}

renameSession(agentId: string, sessionId: string, title: string): SessionInfo {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) throw new Error("title is required");
  if (trimmedTitle.length > 80) {
    throw new Error("title must be 80 characters or less");
  }

  const session = this.sessionStore.getSession(agentId, sessionId);
  if (!session) throw new Error(`Session "${sessionId}" not found`);

  this.sessionStore.updateSessionTitle(agentId, sessionId, trimmedTitle);
  return { ...session, title: trimmedTitle };
}

async deleteProfile(agentId: string): Promise<void> {
  const sessions = this.sessionStore.listSessions(agentId);
  for (const session of sessions) {
    this.activeSessions.delete(session.id);
    this.sessionAgentMap.delete(session.id);
  }
  this.sessionStore.closeAgent(agentId);
  await this.profileStore.delete(agentId);
}

getAgentIdForSession(sessionId: string): string | null {
  return this.sessionAgentMap.get(sessionId) ?? this.sessionStore.findSessionOwner(sessionId);
}
```

New method `getAgentIdForSession` is for ws-chat cold-start: checks the in-memory map first, falls back to scanning open DBs.

- [ ] **Step 2: Verify compilation**

Run: `npm run build --workspace=packages/core`
Expected: compiles (factory.ts still broken, fixed next)

---

### Task 3: Update Factory

**Files:**
- Modify: `packages/core/src/factory.ts`

- [ ] **Step 1: Update createEngine to pass agentsDir to SessionStore**

Change the SessionStore construction in `createEngine`:

```ts
// Before:
const sessionStore = new SessionStore(options?.logger);
await sessionStore.init(path.join(spherseDir, "sessions.db"));

// After:
const agentsPath = path.join(spherseDir, config.paths.agents);
const sessionStore = new SessionStore(agentsPath, options?.logger);
```

The `profileStore` already uses `agentsPath`:
```ts
const profileStore = new AgentProfileStore(
  path.join(spherseDir, config.paths.agents),
);
```

Reuse the same variable for SessionStore. Note: `agentsPath` must be computed before `sessionStore` construction, so compute it right after `config` is available.

Full updated `createEngine`:

```ts
export async function createEngine(
  projectRoot: string,
  options?: { projectName?: string; defaultModel?: string; logger?: Logger },
): Promise<{ engine: Engine; projectStore: ProjectStore }> {
  const projectStore = new ProjectStore(projectRoot, options?.logger);
  let isNewProject = false;
  try {
    await projectStore.open();
  } catch {
    isNewProject = true;
    const dirName = path.basename(path.resolve(projectRoot));
    await projectStore.create(
      options?.projectName ?? dirName,
      options?.defaultModel ?? "gemini-2.5-pro",
    );
  }

  const config = projectStore.getConfig()!;
  const spherseDir = path.join(projectRoot, PROJECT_META_DIR);
  const agentsPath = path.join(spherseDir, config.paths.agents);
  const profileStore = new AgentProfileStore(agentsPath);

  const skillStore = new SkillStore(path.join(spherseDir, "skills"));

  if (isNewProject) {
    await initPresets(projectRoot, spherseDir, profileStore, options?.logger);
  }

  const sessionStore = new SessionStore(agentsPath, options?.logger);

  const engine = new Engine(profileStore, sessionStore, projectStore, skillStore, {
    defaultModel: options?.defaultModel,
    logger: options?.logger,
  });

  return { engine, projectStore };
}
```

- [ ] **Step 2: Verify core compiles**

Run: `npm run build --workspace=packages/core`
Expected: PASS

---

### Task 4: Update SessionStore Tests

**Files:**
- Modify: `packages/core/src/__tests__/store/session.test.ts`

- [ ] **Step 1: Rewrite tests for new SessionStore API**

Tests need to create a mock agent directory structure with `profile.md` files:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import pino from "pino";
import { SessionStore } from "../../store/session.js";

function writeAgentProfile(agentsDir: string, agentId: string, name: string): string {
  const dir = path.join(agentsDir, `${name}-${agentId.slice(0, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "profile.md"),
    `---\nid: ${agentId}\nname: ${name}\ncreatedAt: ${Date.now()}\n---\nTest prompt`,
  );
  return dir;
}

describe("SessionStore", () => {
  let store: SessionStore;
  let tmpDir: string;
  let agentsDir: string;
  const agentId1 = "agent-001";
  const agentId2 = "agent-002";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-session-"));
    agentsDir = path.join(tmpDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    writeAgentProfile(agentsDir, agentId1, "Agent1");
    writeAgentProfile(agentsDir, agentId2, "Agent2");
    store = new SessionStore(agentsDir, pino({ level: "silent" }));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates and retrieves a session", () => {
    const id = store.createSession(agentId1, "Test Session");
    const session = store.getSession(agentId1, id);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(id);
    expect(session!.agentId).toBe(agentId1);
    expect(session!.title).toBe("Test Session");
    expect(session!.status).toBe("active");
  });

  it("creates session without title", () => {
    const id = store.createSession(agentId1);
    const session = store.getSession(agentId1, id);
    expect(session!.title).toBeUndefined();
  });

  it("returns null for non-existent session", () => {
    expect(store.getSession(agentId1, "no-such-id")).toBeNull();
  });

  it("lists sessions for a specific agent", () => {
    store.createSession(agentId1, "First");
    store.createSession(agentId1, "Second");
    store.createSession(agentId2, "Other");
    const sessions = store.listSessions(agentId1);
    expect(sessions).toHaveLength(2);
  });

  it("isolates sessions between agents", () => {
    store.createSession(agentId1, "A1");
    store.createSession(agentId2, "A2");
    expect(store.listSessions(agentId1)).toHaveLength(1);
    expect(store.listSessions(agentId2)).toHaveLength(1);
  });

  it("archives a session", () => {
    const id = store.createSession(agentId1, "To Archive");
    store.archiveSession(agentId1, id);
    const session = store.getSession(agentId1, id);
    expect(session!.status).toBe("archived");
    const active = store.listSessions(agentId1);
    expect(active).toHaveLength(0);
  });

  it("appends and retrieves messages", () => {
    const id = store.createSession(agentId1);
    store.appendMessage(agentId1, id, { role: "user", content: "hello", timestamp: 1000 });
    store.appendMessage(agentId1, id, { role: "assistant", content: "world", timestamp: 2000 });
    const messages = store.getSessionMessages(agentId1, id);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("hello");
    expect(messages[1].content).toBe("world");
  });

  it("updates session updated_at on message append", () => {
    const id = store.createSession(agentId1);
    const before = store.getSession(agentId1, id)!.updatedAt;
    store.appendMessage(agentId1, id, { role: "user", content: "hi", timestamp: Date.now() });
    const after = store.getSession(agentId1, id)!.updatedAt;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("updates session title", () => {
    const id = store.createSession(agentId1, "Old Title");
    store.updateSessionTitle(agentId1, id, "New Title");
    const session = store.getSession(agentId1, id);
    expect(session!.title).toBe("New Title");
  });

  it("lazy opens db on first access", () => {
    expect(store.createSession(agentId1)).toBeDefined();
    const dbPath = path.join(agentsDir, `Agent1-${agentId1.slice(0, 6)}`, "sessions.db");
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("closes agent connection", () => {
    store.createSession(agentId1);
    store.closeAgent(agentId1);
    expect(store.getSession(agentId1, "any")).toBeNull;
  });

  it("finds session owner across open connections", () => {
    const id = store.createSession(agentId1);
    expect(store.findSessionOwner(id)).toBe(agentId1);
    expect(store.findSessionOwner("nonexistent")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test --workspace=packages/core`
Expected: all tests pass

---

### Task 5: Update Server Contracts

**Files:**
- Modify: `packages/server/src/contracts/index.ts`

- [ ] **Step 1: Remove agentId from createSessionRequest**

The `agentId` comes from the URL path now, not the request body. Remove `createSessionRequest` schema (or keep it empty — the POST body is now `{}`).

```ts
// Before:
createSessionRequest: Type.Object({ agentId: Type.String({ minLength: 1 }) }),

// After:
createSessionRequest: Type.Object({}),
```

Also remove the `CreateSessionRequest` type export since it's no longer meaningful, or keep it as an empty object type.

- [ ] **Step 2: Verify server compiles**

Run: `npm run build --workspace=packages/server`
Expected: compiles (routes will be broken, fixed in Task 6)

---

### Task 6: Update Server Routes

**Files:**
- Modify: `packages/server/src/routes/sessions.ts`
- Modify: `packages/server/src/ws-chat.ts`
- Modify: `packages/server/src/routes/debug.ts`

- [ ] **Step 1: Rewrite session routes with new paths**

```ts
import type { FastifyInstance } from "fastify";
import { schemas } from "@spherse/server/contracts";
import type { AppContext } from "../index.js";

export function registerSessionRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  fastify.get<{ Params: { agentId: string } }>(
    "/api/agents/:agentId/sessions",
    async (req) => {
      return ctx.engine.listSessions(req.params.agentId);
    },
  );

  fastify.post<{ Params: { agentId: string } }>(
    "/api/agents/:agentId/sessions",
    {
      schema: {
        response: {
          200: schemas.createSessionResponse,
          404: schemas.errorResponse,
        },
      },
    },
    async (req, reply) => {
      try {
        const sessionId = await ctx.engine.createSession(req.params.agentId);
        return { sessionId };
      } catch (err: any) {
        return reply.code(404).send({ error: err.message });
      }
    },
  );

  fastify.get<{ Params: { agentId: string; sessionId: string } }>(
    "/api/agents/:agentId/sessions/:sessionId",
    async (req, reply) => {
      const session = ctx.engine.getSession(req.params.agentId, req.params.sessionId);
      if (!session)
        return reply.code(404).send({ error: "Session not found" });
      return session;
    },
  );

  fastify.get<{ Params: { agentId: string; sessionId: string } }>(
    "/api/agents/:agentId/sessions/:sessionId/messages",
    async (req) => {
      return ctx.engine.getSessionHistory(req.params.agentId, req.params.sessionId);
    },
  );

  fastify.patch<{ Params: { agentId: string; sessionId: string }; Body: { title?: unknown } }>(
    "/api/agents/:agentId/sessions/:sessionId",
    {
      schema: {
        body: schemas.renameSessionRequest,
        response: {
          200: schemas.sessionInfo,
          400: schemas.errorResponse,
          404: schemas.errorResponse,
        },
      },
    },
    async (req, reply) => {
      const { title } = req.body ?? {};
      if (typeof title !== "string") {
        return reply.code(400).send({ error: "title is required" });
      }

      try {
        return ctx.engine.renameSession(req.params.agentId, req.params.sessionId, title);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : "request failed";
        if (message.includes("not found")) {
          return reply.code(404).send({ error: message });
        }
        return reply.code(400).send({ error: message });
      }
    },
  );

  fastify.delete<{ Params: { agentId: string; sessionId: string } }>(
    "/api/agents/:agentId/sessions/:sessionId",
    async (req) => {
      ctx.engine.deleteSession(req.params.agentId, req.params.sessionId);
      return { ok: true };
    },
  );
}
```

- [ ] **Step 2: Update ws-chat to use getAgentIdForSession**

In `ws-chat.ts`, the `restoreSession` call needs `agentId`. Use `getAgentIdForSession`:

```ts
export function handleChatWebSocket(
  fastify: FastifyInstance,
  ctx: AppContext,
) {
  fastify.get<{ Params: { sessionId: string } }>(
    "/ws/chat/:sessionId",
    { websocket: true },
    (socket, req) => {
      const { sessionId } = req.params;
      fastify.log.info({ sessionId }, "chat ws connected");

      const agentId = ctx.engine.getAgentIdForSession(sessionId);
      if (!agentId) {
        socket.send(JSON.stringify({ type: "error", message: "Session not found" }));
        socket.close();
        return;
      }

      ctx.engine.restoreSession(agentId, sessionId).catch((err) => {
        const message = err instanceof Error ? err.message : "request failed";
        socket.send(JSON.stringify({ type: "error", message }));
        socket.close();
      });

      socket.on("message", async (raw: Buffer) => {
        let msg: ReturnType<typeof parseChatClientMessage>;
        try {
          msg = parseChatClientMessage(JSON.parse(raw.toString()));
        } catch (err) {
          fastify.log.warn({ err, sessionId }, "invalid chat ws message");
          socket.send(
            JSON.stringify({
              type: "error",
              message: "Invalid WebSocket message",
            }),
          );
          return;
        }

        if (msg.type === "message") {
          try {
            await ctx.engine.sendMessage(sessionId, msg.content, (event) => {
              socket.send(JSON.stringify(parseChatServerEvent(event)));
            });
          } catch (err: any) {
            fastify.log.error({ err, sessionId }, "chat ws message error");
            socket.send(
              JSON.stringify(parseChatServerEvent({ type: "error", message: err.message })),
            );
          }
        } else if (msg.type === "abort") {
          ctx.engine.abortSession(sessionId);
        }
      });

      socket.on("close", () => {
        fastify.log.info({ sessionId }, "chat ws disconnected");
      });
    },
  );
}
```

Note: `sendMessage` and `abortSession` still take only `sessionId` — they use `activeSessions` map internally, no agentId needed.

- [ ] **Step 3: Update debug route**

`getTurnContext` uses `activeSessions` map, no agentId needed. Route stays the same. But if the debug route should also be under agent scope for consistency, it can remain as-is since it uses the in-memory map.

No change needed for `debug.ts`.

- [ ] **Step 4: Verify server compiles**

Run: `npm run build --workspace=packages/server`
Expected: PASS

---

### Task 7: Update Frontend API Client

**Files:**
- Modify: `packages/app/src/lib/api.ts`

- [ ] **Step 1: Update all session API method signatures and URLs**

Change these methods in `createApiClient`:

```ts
async createSession(agentId: string): Promise<{ sessionId: string }> {
  const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(agentId)}/sessions`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request failed" }));
    throw new Error(err.error ?? "request failed");
  }
  return parseJsonResponse(res, schemas.createSessionResponse);
},

async getSession(agentId: string, id: string): Promise<SessionInfo> {
  const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}`);
  return res.json();
},

async listSessions(agentId: string): Promise<SessionInfo[]> {
  const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(agentId)}/sessions`);
  return res.json();
},

async getSessionMessages(agentId: string, id: string): Promise<ChatMessage[]> {
  const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}/messages`);
  return res.json();
},

async renameSession(agentId: string, id: string, title: string): Promise<SessionInfo> {
  const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request failed" }));
    throw new Error(err.error ?? "request failed");
  }
  return parseJsonResponse(res, schemas.sessionInfo);
},

async deleteSession(agentId: string, id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request failed" }));
    throw new Error(err.error ?? "request failed");
  }
  return parseJsonResponse(res, schemas.okResponse);
},
```

All 6 methods now take `agentId` as the first parameter. The `createSession` body no longer contains `agentId`.

- [ ] **Step 2: Verify app compiles**

Run: `npm run build --workspace=packages/app`
Expected: compiles with type errors in store (fixed in Task 8)

---

### Task 8: Update Frontend Store

**Files:**
- Modify: `packages/app/src/stores/project-data-store.ts`

- [ ] **Step 1: Update store to pass agentId to API client**

Key changes in `project-data-store.ts`:

**`refreshSessions`** — needs to fetch sessions for each agent. Since we don't have a "list all sessions" API anymore, we need to aggregate from all agents:

```ts
async refreshSessions(projectKey, client) {
  set((state) => updateProjectData(state, projectKey, (project) => ({
    ...project,
    error: null,
  })));

  try {
    const agents = get().projects[projectKey]?.agents ?? [];
    const allSessions = await Promise.all(
      agents.map((agent) => client.listSessions(agent.id)),
    );
    const sessions = allSessions.flat();
    set((state) => updateProjectData(state, projectKey, (project) => ({
      ...project,
      sessions: [
        ...project.sessions.filter((session) =>
          project.initialMessageBySessionId[session.id] &&
          !sessions.some((item) => item.id === session.id),
        ),
        ...sessions,
      ],
      error: null,
    }), { createIfMissing: false }));
  } catch (err) {
    set((state) => updateProjectData(state, projectKey, (project) => ({
      ...project,
      error: getErrorMessage(err),
    }), { createIfMissing: false }));
  }
},
```

**`createSession`** — already has `agentId`, just pass it:

```ts
async createSession(projectKey, client, agentId, initialMessage) {
  // ... existing error handling ...
  const { sessionId } = await client.createSession(agentId);
  // ... rest unchanged ...
},
```

No change needed in `createSession` — `client.createSession(agentId)` signature is the same.

**`deleteSession`** — needs `agentId` from session data:

```ts
async deleteSession(projectKey, client, sessionId) {
  try {
    const project = get().projects[projectKey];
    const session = project?.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    await client.deleteSession(session.agentId, sessionId);
    // ... rest unchanged ...
  } catch (err) {
    // ... unchanged ...
  }
},
```

**`renameSession`** — needs `agentId`:

```ts
async renameSession(projectKey, client, sessionId, title) {
  try {
    const project = get().projects[projectKey];
    const session = project?.sessions.find((s) => s.id === sessionId);
    if (!session) return false;
    const updatedSession = await client.renameSession(session.agentId, sessionId, title);
    // ... rest unchanged ...
  } catch (err) {
    // ... unchanged ...
  }
},
```

**`deleteAgent`** — already has `agentId`, but the follow-up `refreshSessions` needs agents list first. Call `refreshAgents` before `refreshSessions`:

```ts
async deleteAgent(projectKey, client, agentId) {
  try {
    await client.deleteAgent(agentId);
    await get().refreshAgents(projectKey, client);
    await get().refreshSessions(projectKey, client);
  } catch (err) {
    set((state) => updateProjectData(state, projectKey, (project) => ({
      ...project,
      error: getErrorMessage(err),
    }), { createIfMissing: false }));
  }
},
```

The `Promise.all` in the original becomes sequential because `refreshSessions` needs updated agents list first.

- [ ] **Step 2: Verify app compiles**

Run: `npm run build --workspace=packages/app`
Expected: PASS

---

### Task 9: Update Frontend Store Tests

**Files:**
- Modify: `packages/app/src/stores/project-data-store.test.ts`

- [ ] **Step 1: Update mock API client signatures**

Update the `createClient` function and affected tests:

```ts
function createClient(overrides: Partial<ApiClient>): ApiClient {
  return {
    listAgents: vi.fn().mockResolvedValue([]),
    getAgent: vi.fn(),
    createSession: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
    getSession: vi.fn(),
    listSessions: vi.fn().mockResolvedValue([]),
    getSessionMessages: vi.fn().mockResolvedValue([]),
    // ... other methods unchanged ...
  } as ApiClient;
}
```

The mock for `createSession` doesn't need to change — it's called with `(agentId)` which is the same. But `listSessions`, `deleteSession`, `renameSession` now take `agentId` as first arg.

Key test that needs updating — "uses the provided client when refreshing agents" needs agents loaded first for `refreshSessions` to work:

```ts
it("does not recreate a cleared project when a sessions refresh resolves late", async () => {
  let resolveSessions: (sessions: SessionInfo[]) => void = () => {};
  const client = createClient({
    listAgents: vi.fn().mockResolvedValue([createAgent("agent-1")]),
    listSessions: vi.fn().mockReturnValue(new Promise<SessionInfo[]>((resolve) => {
      resolveSessions = resolve;
    })),
  });

  await useProjectDataStore.getState().refreshAgents("project-1", client);
  const refresh = useProjectDataStore.getState().refreshSessions("project-1", client);
  useProjectDataStore.getState().clearProjectData("project-1");
  resolveSessions([createSession("session-1")]);
  await refresh;

  expect(client.listSessions).toHaveBeenCalledWith("agent-1");
  expect(useProjectDataStore.getState().projects["project-1"]).toBeUndefined();
});
```

Test "renames a session in the project cache":

```ts
it("renames a session in the project cache", async () => {
  const client = createClient({
    listAgents: vi.fn().mockResolvedValue([createAgent("agent-1")]),
    listSessions: vi.fn().mockResolvedValue([createSession("session-1")]),
    renameSession: vi.fn().mockResolvedValue({
      ...createSession("session-1"),
      title: "Renamed Session",
    }),
  });

  await useProjectDataStore.getState().refreshAgents("project-1", client);
  await useProjectDataStore.getState().refreshSessions("project-1", client);
  const ok = await useProjectDataStore.getState().renameSession(
    "project-1",
    client,
    "session-1",
    "Renamed Session",
  );

  expect(ok).toBe(true);
  expect(client.renameSession).toHaveBeenCalledWith("agent-1", "session-1", "Renamed Session");
  // ...
});
```

- [ ] **Step 2: Run tests**

Run: `npm test --workspace=packages/app`
Expected: all tests pass

---

### Task 10: Update E2E Tests

**Files:**
- Modify: `packages/app/e2e/session-rename.spec.ts`
- Modify: `packages/app/e2e/chat-streaming-resilience.spec.ts`

- [ ] **Step 1: Update hardcoded API URLs in both E2E files**

Both files have an identical `createSessionViaApi` function that calls `POST /api/sessions`. Update to:

```ts
async function createSessionViaApi(page: Page, projectRoot: string, agentId: string): Promise<string> {
  const port: number = await page.evaluate(
    (dir) => window.electronAPI.startServer(dir),
    projectRoot,
  );
  const res = await fetch(`http://localhost:${port}/api/agents/${encodeURIComponent(agentId)}/sessions`, {
    method: "POST",
  });
  const { sessionId } = await res.json() as { sessionId: string };
  return sessionId;
}
```

The function signature and return type remain the same — only the URL changes.

Apply this change to both files:
- `packages/app/e2e/session-rename.spec.ts` line 67
- `packages/app/e2e/chat-streaming-resilience.spec.ts` line 67

---

### Task 11: Write Migration Script

**Files:**
- Create: `scripts/migrate-session-db.ts`

- [ ] **Step 1: Create migration script**

```ts
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const projectRoot = process.argv[2];
if (!projectRoot) {
  console.error("Usage: npx tsx scripts/migrate-session-db.ts <project-root>");
  process.exit(1);
}

const spherseDir = path.join(projectRoot, ".spherse");
const oldDbPath = path.join(spherseDir, "sessions.db");
const agentsDir = path.join(spherseDir, "agents");

if (!fs.existsSync(oldDbPath)) {
  console.log("No sessions.db found, nothing to migrate.");
  process.exit(0);
}

const oldDb = new Database(oldDbPath, { readonly: true });

const agentIds = oldDb.prepare("SELECT DISTINCT agent_id FROM sessions").all() as any[];
console.log(`Found ${agentIds.length} agent(s) with sessions.`);

function findAgentDir(agentId: string): string | null {
  const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const profilePath = path.join(agentsDir, entry.name, "profile.md");
    try {
      const raw = fs.readFileSync(profilePath, "utf-8");
      const { data } = matter(raw);
      if (data.id === agentId) return path.join(agentsDir, entry.name);
    } catch {
      continue;
    }
  }
  return null;
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
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
`;

for (const { agent_id: agentId } of agentIds) {
  const agentDir = findAgentDir(agentId);
  if (!agentDir) {
    console.warn(`  WARNING: agent directory not found for ${agentId}, skipping.`);
    continue;
  }

  const newDbPath = path.join(agentDir, "sessions.db");
  if (fs.existsSync(newDbPath)) {
    console.warn(`  WARNING: ${newDbPath} already exists, skipping.`);
    continue;
  }

  const newDb = new Database(newDbPath);
  newDb.pragma("journal_mode = WAL");
  newDb.exec(MIGRATION);

  const sessions = oldDb.prepare("SELECT * FROM sessions WHERE agent_id = ?").all(agentId) as any[];
  const insertSession = newDb.prepare(
    "INSERT INTO sessions (id, agent_id, title, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?)",
  );

  const insertMessage = newDb.prepare(
    "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
  );

  let messageCount = 0;
  for (const session of sessions) {
    insertSession.run(session.id, session.agent_id, session.title, session.created_at, session.updated_at, session.status);
    const messages = oldDb.prepare("SELECT * FROM messages WHERE session_id = ?").all(session.id) as any[];
    for (const msg of messages) {
      insertMessage.run(msg.session_id, msg.role, msg.content, msg.timestamp);
      messageCount += 1;
    }
  }

  newDb.close();
  console.log(`  Migrated ${sessions.length} session(s), ${messageCount} message(s) for agent ${agentId} → ${newDbPath}`);
}

oldDb.close();

const backupPath = oldDbPath + ".bak";
fs.renameSync(oldDbPath, backupPath);
console.log(`\nOriginal DB backed up to ${backupPath}`);
console.log("Migration complete.");
```

This script:
1. Opens old `sessions.db` read-only
2. Gets distinct agent IDs
3. For each: finds agent directory, creates new DB, copies sessions + messages
4. Backs up old DB as `.bak`

Run: `npx tsx scripts/migrate-session-db.ts /path/to/project`

---

### Task 12: Full Verification

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: all packages compile

- [ ] **Step 3: Run core tests**

Run: `npm test --workspace=packages/core`
Expected: all pass

- [ ] **Step 4: Run server tests**

Run: `npm test --workspace=packages/server`
Expected: all pass

- [ ] **Step 5: Run app tests**

Run: `npm test --workspace=packages/app`
Expected: all pass

- [ ] **Step 6: Delete old sessions.db reference**

Verify no code references `.spherse/sessions.db` path anymore (search for `sessions.db` across the codebase). The only reference should be in the migration script.
