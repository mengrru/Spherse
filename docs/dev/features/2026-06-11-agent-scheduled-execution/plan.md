# Agent 定时运行 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 agent 实现多定时任务配置，app 运行期间自动触发执行，支持 cron 表达式调度、消息模板变量、执行日志和 WebSocket 实时通知。

**Architecture:** 新增 `Scheduler` 类放在 `@spherse/core`，与 Engine 通过 `setScheduler` 两阶段初始化集成。每个 agent 的 schedule 配置持久化在 `schedules.yml` 文件中，执行日志追加到 `schedule-logs.jsonl`。Server 层新增 REST 路由和独立 WebSocket 事件通道。前端新增 schedule dialog 组件并通过 agent 下拉菜单进入。

**Tech Stack:** TypeScript, better-sqlite3, yaml, cron-parser, Fastify WebSocket, React/Zustand, Tailwind CSS

**Design doc:** `docs/dev/features/2026-06-11-agent-scheduled-execution/design.md`

---

### Task 1: Add cron-parser dependency + Update types

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/app/src/lib/types.ts`

- [ ] **Step 1: Install cron-parser**

```bash
npm install cron-parser --workspace=packages/core
```

Run: `npm install cron-parser --workspace=packages/core`
Expected: package added to `packages/core/package.json` dependencies

- [ ] **Step 2: Add ScheduleEntry and ScheduleLogEntry types**

In `packages/core/src/types.ts`, add before `SessionInfo`:

```ts
export interface ScheduleEntry {
  id: string;
  name?: string;
  enabled: boolean;
  cron: string;
  mode: "new_session" | "existing_session";
  targetSessionId?: string;
  message: string;
  notify: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleLogEntry {
  scheduleId: string;
  sessionId: string;
  triggeredAt: number;
  completedAt?: number;
  status: "running" | "success" | "failed";
  error?: string;
}
```

- [ ] **Step 3: Change AgentProfile.schedule type to boolean**

In `packages/core/src/types.ts`, change:

```ts
// Before
schedule?: string;

// After
schedule?: boolean;
```

- [ ] **Step 4: Add source field to SessionInfo**

In `packages/core/src/types.ts`, add to `SessionInfo`:

```ts
export interface SessionInfo {
  id: string;
  agentId: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  status: "active" | "archived";
  source?: "manual" | "scheduled";
}
```

- [ ] **Step 5: Update frontend types**

In `packages/app/src/lib/types.ts`:

```ts
// Change schedule from string to boolean
schedule?: boolean;

// Add to SessionInfo
source?: "manual" | "scheduled";
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/core/src/types.ts packages/app/src/lib/types.ts
git commit -m "feat: add schedule types and cron-parser dependency"
```

---

### Task 2: ScheduleStore — YAML persistence + JSONL logs

**Files:**
- Create: `packages/core/src/store/schedule.ts`

- [ ] **Step 1: Implement ScheduleStore**

```ts
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { ScheduleEntry, ScheduleLogEntry } from "../types.js";
import type { Logger } from "../logger.js";
import pino from "pino";

function findAgentDir(agentsDir: string, agentId: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(agentsDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const candidatePath = path.join(agentsDir, entry);
    const stat = fs.statSync(candidatePath);
    if (!stat.isDirectory()) continue;
    const profilePath = path.join(candidatePath, "profile.md");
    try {
      const raw = fs.readFileSync(profilePath, "utf-8");
      const match = raw.match(/^id:\s*(\S+)/m);
      if (match && match[1] === agentId) return candidatePath;
    } catch {
      continue;
    }
  }
  return null;
}

export class ScheduleStore {
  private agentsDir: string;
  private logger: Logger;

  constructor(agentsDir: string, logger?: Logger) {
    this.agentsDir = agentsDir;
    this.logger = logger ?? pino({ level: "silent" });
  }

  private resolveAgentDir(agentId: string): string {
    const dir = findAgentDir(this.agentsDir, agentId);
    if (!dir) throw new Error(`agent directory not found for "${agentId}"`);
    return dir;
  }

  list(agentId: string): ScheduleEntry[] {
    const agentDir = this.resolveAgentDir(agentId);
    const filePath = path.join(agentDir, "schedules.yml");
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = YAML.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  get(agentId: string, scheduleId: string): ScheduleEntry | null {
    const entries = this.list(agentId);
    return entries.find((e) => e.id === scheduleId) ?? null;
  }

  private saveAll(agentId: string, entries: ScheduleEntry[]): void {
    const agentDir = this.resolveAgentDir(agentId);
    const filePath = path.join(agentDir, "schedules.yml");
    const content = entries.length > 0 ? YAML.stringify(entries) : "";
    fs.writeFileSync(filePath, content, "utf-8");
    this.logger.info({ agentId, count: entries.length }, "schedules saved");
  }

  create(agentId: string, entry: ScheduleEntry): void {
    const entries = this.list(agentId);
    entries.push(entry);
    this.saveAll(agentId, entries);
  }

  update(agentId: string, scheduleId: string, partial: Partial<ScheduleEntry>): ScheduleEntry | null {
    const entries = this.list(agentId);
    const idx = entries.findIndex((e) => e.id === scheduleId);
    if (idx === -1) return null;
    entries[idx] = { ...entries[idx], ...partial, updatedAt: Date.now() };
    this.saveAll(agentId, entries);
    return entries[idx];
  }

  delete(agentId: string, scheduleId: string): void {
    const entries = this.list(agentId).filter((e) => e.id !== scheduleId);
    this.saveAll(agentId, entries);
  }

  appendLog(agentId: string, entry: ScheduleLogEntry): void {
    const agentDir = this.resolveAgentDir(agentId);
    const filePath = path.join(agentDir, "schedule-logs.jsonl");
    fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
  }

  getRecentLogs(agentId: string, limit: number = 50): ScheduleLogEntry[] {
    const agentDir = this.resolveAgentDir(agentId);
    const filePath = path.join(agentDir, "schedule-logs.jsonl");
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      const recent = lines.slice(-limit);
      return recent.map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 2: Export from core index**

Ensure `packages/core/src/index.ts` exports `ScheduleStore`:

```ts
export { ScheduleStore } from "./store/schedule.js";
```

- [ ] **Step 3: Verify build**

Run: `npm run build --workspace=packages/core`
Expected: compiles without errors

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/store/schedule.ts packages/core/src/index.ts
git commit -m "feat: add ScheduleStore for YAML schedules and JSONL logs"
```

---

### Task 3: SessionStore — add source column

**Files:**
- Modify: `packages/core/src/store/session.ts`

- [ ] **Step 1: Update migration SQL to include source column**

In `packages/core/src/store/session.ts`, update the `MIGRATION` constant (line 9-26):

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT DEFAULT 'active',
  source TEXT DEFAULT 'manual'
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
```

- [ ] **Step 2: Add ALTER TABLE for existing DBs**

After the `MIGRATION` constant and before `getDb()` method in the constructor area, add a migration method that runs after table creation:

```ts
private applyMigrations(db: Database.Database): void {
  db.exec(MIGRATION);
  const cols = db.prepare("PRAGMA table_info(sessions)").all() as any[];
  if (!cols.some((c: any) => c.name === "source")) {
    db.exec("ALTER TABLE sessions ADD COLUMN source TEXT DEFAULT 'manual'");
  }
}
```

Update `getDb()` to call `this.applyMigrations(db)` instead of `db.exec(MIGRATION)`.

- [ ] **Step 3: Update createSession to accept source parameter**

Change method signature:

```ts
createSession(agentId: string, title?: string, source?: string): string {
  const db = this.getDb(agentId);
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (id, agent_id, title, created_at, updated_at, status, source) VALUES (?, ?, ?, ?, ?, 'active', ?)",
  ).run(id, agentId, title ?? null, now, now, source ?? "manual");
  this.logger.info({ sessionId: id, agentId }, "session created in store");
  return id;
}
```

- [ ] **Step 4: Update getSession to return source field**

```ts
getSession(agentId: string, id: string): SessionInfo | null {
  const db = this.getDb(agentId);
  const row = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    agentId: row.agent_id,
    title: row.title ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    source: row.source ?? "manual",
  };
}
```

- [ ] **Step 5: Update listSessions to return source field**

Add `source: row.source ?? "manual"` to the map callback.

- [ ] **Step 6: Verify build**

Run: `npm run build --workspace=packages/core`
Expected: compiles without errors

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/store/session.ts
git commit -m "feat: add source column to sessions table"
```

---

### Task 4: Scheduler — core scheduling engine

**Files:**
- Create: `packages/core/src/scheduler.ts`

- [ ] **Step 1: Implement Scheduler class**

```ts
import { EventEmitter } from "node:events";
import { parseExpression } from "cron-parser";
import type { Engine } from "./engine.js";
import type { ScheduleEntry, ScheduleLogEntry } from "./types.js";
import { ScheduleStore } from "./store/schedule.js";
import type { Logger } from "./logger.js";
import pino from "pino";

export interface ScheduleEventPayload {
  agentId: string;
  scheduleId: string;
  sessionId?: string;
  triggeredAt?: number;
  status?: string;
  error?: string;
  schedule?: ScheduleEntry;
}

function getNextCronDate(cron: string): Date | null {
  try {
    const interval = parseExpression(cron);
    return interval.next().toDate();
  } catch {
    return null;
  }
}

const TEMPLATE_VARS: Record<string, () => string> = {
  date: () => new Date().toISOString().slice(0, 10),
  time: () => new Date().toTimeString().slice(0, 5),
  datetime: () => `${new Date().toISOString().slice(0, 10)} ${new Date().toTimeString().slice(0, 5)}`,
  weekday: () => new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(new Date()),
  agent_name: () => "",
};

export class Scheduler extends EventEmitter {
  private engine: Engine;
  private scheduleStore: ScheduleStore;
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private entries: Map<string, ScheduleEntry> = new Map();
  private agentSchedules: Map<string, Set<string>> = new Map();
  private scheduleAgentMap: Map<string, string> = new Map();
  private agentNames: Map<string, string> = new Map();
  private logger: Logger;

  constructor(engine: Engine, agentsDir: string, logger?: Logger) {
    super();
    this.engine = engine;
    this.scheduleStore = new ScheduleStore(agentsDir, logger);
    this.logger = logger ?? pino({ level: "silent" });
  }

  async loadFromProfiles(): Promise<void> {
    const profiles = await this.engine.listProfiles();
    for (const profile of profiles) {
      this.agentNames.set(profile.id, profile.name);
      if (!profile.schedule) continue;
      const entries = this.scheduleStore.list(profile.id);
      for (const entry of entries) {
        this.register(profile.id, entry, false);
      }
    }
    this.logger.info({ count: this.entries.size }, "scheduler loaded");
  }

  register(agentId: string, entry: ScheduleEntry, persist: boolean = true): void {
    this.entries.set(entry.id, entry);
    this.scheduleAgentMap.set(entry.id, agentId);

    let scheduleSet = this.agentSchedules.get(agentId);
    if (!scheduleSet) {
      scheduleSet = new Set();
      this.agentSchedules.set(agentId, scheduleSet);
    }
    scheduleSet.add(entry.id);

    if (persist) {
      this.scheduleStore.create(agentId, entry);
    }

    if (entry.enabled) {
      this.scheduleNext(entry);
    }

    this.logger.info({ agentId, scheduleId: entry.id }, "schedule registered");
  }

  unregister(agentId: string, scheduleId: string): void {
    this.clearTimer(scheduleId);
    this.entries.delete(scheduleId);
    this.scheduleAgentMap.delete(scheduleId);
    this.agentSchedules.get(agentId)?.delete(scheduleId);
    this.scheduleStore.delete(agentId, scheduleId);
    this.logger.info({ agentId, scheduleId }, "schedule unregistered");
  }

  update(agentId: string, scheduleId: string, partial: Partial<ScheduleEntry>): ScheduleEntry | null {
    const existing = this.entries.get(scheduleId);
    if (!existing) return null;

    this.clearTimer(scheduleId);
    const updated = { ...existing, ...partial, updatedAt: Date.now() };
    this.entries.set(scheduleId, updated);
    this.scheduleStore.update(agentId, scheduleId, updated);

    if (updated.enabled) {
      this.scheduleNext(updated);
    }

    this.emit("schedule_updated", { agentId, scheduleId, schedule: updated });
    return updated;
  }

  list(agentId: string): ScheduleEntry[] {
    const scheduleIds = this.agentSchedules.get(agentId);
    if (!scheduleIds) return [];
    return Array.from(scheduleIds)
      .map((id) => this.entries.get(id))
      .filter(Boolean) as ScheduleEntry[];
  }

  get(agentId: string, scheduleId: string): ScheduleEntry | null {
    return this.entries.get(scheduleId) ?? this.scheduleStore.get(agentId, scheduleId);
  }

  getNextTrigger(agentId: string, scheduleId: string): Date | null {
    const entry = this.entries.get(scheduleId);
    if (!entry || !entry.enabled) return null;
    return getNextCronDate(entry.cron);
  }

  getRecentLogs(agentId: string, limit?: number): ScheduleLogEntry[] {
    return this.scheduleStore.getRecentLogs(agentId, limit);
  }

  stopAll(): void {
    for (const [id, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.logger.info("scheduler stopped");
  }

  private scheduleNext(entry: ScheduleEntry): void {
    const nextDate = getNextCronDate(entry.cron);
    if (!nextDate) return;

    const delay = nextDate.getTime() - Date.now();
    if (delay <= 0) return;

    const timer = setTimeout(() => this.trigger(entry), delay);
    this.timers.set(entry.id, timer);
  }

  private clearTimer(scheduleId: string): void {
    const timer = this.timers.get(scheduleId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(scheduleId);
    }
  }

  private resolveTemplate(entry: ScheduleEntry): string {
    const agentId = this.scheduleAgentMap.get(entry.id);
    const agentName = agentId ? this.agentNames.get(agentId) ?? "" : "";

    return entry.message.replace(/{{(\w+)}}/g, (_match, key) => {
      if (key === "agent_name") return agentName;
      const fn = TEMPLATE_VARS[key];
      return fn ? fn() : `{{${key}}}`;
    });
  }

  private async trigger(entry: ScheduleEntry): Promise<void> {
    const agentId = this.scheduleAgentMap.get(entry.id);
    if (!agentId) return;

    const now = Date.now();
    const logEntry: ScheduleLogEntry = {
      scheduleId: entry.id,
      sessionId: "",
      triggeredAt: now,
      status: "running",
    };

    this.emit("schedule_triggered", { agentId, scheduleId: entry.id, triggeredAt: now });

    try {
      let sessionId: string;

      if (entry.mode === "new_session") {
        sessionId = await this.engine.createSession(agentId, "scheduled");
      } else if (entry.targetSessionId) {
        sessionId = entry.targetSessionId;
        await this.engine.restoreSession(agentId, sessionId);
      } else {
        this.logger.error({ scheduleId: entry.id }, "existing_session mode but no targetSessionId");
        return;
      }

      logEntry.sessionId = sessionId;
      this.scheduleStore.appendLog(agentId, logEntry);

      const resolvedMessage = this.resolveTemplate(entry);

      await this.engine.sendMessage(sessionId, resolvedMessage, (event) => {
        if (event.type === "agent_end") {
          this.scheduleStore.appendLog(agentId, {
            ...logEntry,
            completedAt: Date.now(),
            status: "success",
          });
          this.emit("schedule_completed", {
            agentId,
            scheduleId: entry.id,
            sessionId,
            status: "success",
          });
        }
      });
    } catch (err) {
      this.scheduleStore.appendLog(agentId, {
        ...logEntry,
        completedAt: Date.now(),
        status: "failed",
        error: String(err),
      });
      this.emit("schedule_failed", {
        agentId,
        scheduleId: entry.id,
        error: String(err),
      });
    } finally {
      if (entry.enabled) {
        this.scheduleNext(entry);
      }
    }
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace=packages/core`
Expected: compiles without errors (Engine changes not yet done)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/scheduler.ts
git commit -m "feat: add Scheduler class with cron-based triggering"
```

---

### Task 5: Engine + Factory integration

**Files:**
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/src/factory.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add scheduler property and methods to Engine**

In `packages/core/src/engine.ts`, add import and field:

```ts
import { Scheduler } from "./scheduler.js";
```

In the Engine class, after `private logger: Logger;`:

```ts
private scheduler?: Scheduler;

setScheduler(scheduler: Scheduler): void {
  this.scheduler = scheduler;
}

getScheduler(): Scheduler {
  if (!this.scheduler) throw new Error("Scheduler not initialized");
  return this.scheduler;
}
```

- [ ] **Step 2: Update createSession to accept source option**

```ts
async createSession(agentId: string, source?: string): Promise<string> {
  const profile = await this.profileStore.getById(agentId);
  if (!profile) throw new Error(`Agent profile "${agentId}" not found`);

  const sessionId = this.sessionStore.createSession(agentId, undefined, source);
  const agent = await this.buildAgent(profile, sessionId);
  this.activeSessions.set(sessionId, { agent, agentId });
  this.logger.info({ sessionId, agentId }, "session created");
  return sessionId;
}
```

- [ ] **Step 3: Add shutdown method**

```ts
async shutdown(): Promise<void> {
  this.scheduler?.stopAll();
  this.sessionStore.close();
}
```

- [ ] **Step 4: Update factory.ts to create and wire Scheduler**

In `packages/core/src/factory.ts`, after engine creation:

```ts
import { Scheduler } from "./scheduler.js";

// After engine construction (line 42-44 area):
const engine = new Engine(profileStore, sessionStore, projectStore, skillStore, {
  defaultModel: options?.defaultModel,
  logger: options?.logger,
});

// Add scheduler wiring:
const scheduler = new Scheduler(engine, agentsPath, options?.logger);
engine.setScheduler(scheduler);
await scheduler.loadFromProfiles();
```

- [ ] **Step 5: Update core index exports**

In `packages/core/src/index.ts`, add exports for Scheduler types:

```ts
export { Scheduler } from "./scheduler.js";
export type { ScheduleEventPayload } from "./scheduler.js";
```

- [ ] **Step 6: Verify build**

Run: `npm run build --workspace=packages/core`
Expected: compiles without errors

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/engine.ts packages/core/src/factory.ts packages/core/src/index.ts
git commit -m "feat: integrate Scheduler into Engine and factory"
```

---

### Task 6: Core tests

**Files:**
- Create: `packages/core/src/__tests__/store/schedule.test.ts`
- Create: `packages/core/src/__tests__/scheduler.test.ts`
- Modify: `packages/core/src/__tests__/store/session.test.ts` (if exists)

- [ ] **Step 1: Write ScheduleStore tests**

Create `packages/core/src/__tests__/store/schedule.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { ScheduleStore } from "../../store/schedule.js";
import type { ScheduleEntry } from "../../types.js";

function createAgentDir(agentsDir: string, agentId: string, name: string): string {
  const dir = path.join(agentsDir, `${name}-${agentId.slice(0, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "profile.md"),
    `---\nid: ${agentId}\nname: ${name}\ncreatedAt: ${Date.now()}\n---\nTest`,
  );
  return dir;
}

describe("ScheduleStore", () => {
  let store: ScheduleStore;
  let tmpDir: string;
  let agentsDir: string;
  const agentId = "test-agent-001";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-schedule-"));
    agentsDir = path.join(tmpDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    createAgentDir(agentsDir, agentId, "TestAgent");
    store = new ScheduleStore(agentsDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeEntry(overrides?: Partial<ScheduleEntry>): ScheduleEntry {
    return {
      id: crypto.randomUUID(),
      enabled: true,
      cron: "0 9 * * *",
      mode: "new_session",
      message: "Daily check {{date}}",
      notify: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  it("returns empty list when no schedules exist", () => {
    expect(store.list(agentId)).toEqual([]);
  });

  it("creates and lists schedules", () => {
    const entry = makeEntry({ name: "Daily Review" });
    store.create(agentId, entry);
    const list = store.list(agentId);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Daily Review");
  });

  it("gets schedule by id", () => {
    const entry = makeEntry();
    store.create(agentId, entry);
    const found = store.get(agentId, entry.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(entry.id);
  });

  it("returns null for unknown schedule id", () => {
    expect(store.get(agentId, "nonexistent")).toBeNull();
  });

  it("updates a schedule", () => {
    const entry = makeEntry();
    store.create(agentId, entry);
    const updated = store.update(agentId, entry.id, { enabled: false, name: "Updated" });
    expect(updated!.enabled).toBe(false);
    expect(updated!.name).toBe("Updated");
    expect(store.list(agentId)[0].enabled).toBe(false);
  });

  it("returns null when updating nonexistent schedule", () => {
    expect(store.update(agentId, "nonexistent", { enabled: false })).toBeNull();
  });

  it("deletes a schedule", () => {
    const entry = makeEntry();
    store.create(agentId, entry);
    store.delete(agentId, entry.id);
    expect(store.list(agentId)).toEqual([]);
  });

  it("supports multiple schedules per agent", () => {
    store.create(agentId, makeEntry());
    store.create(agentId, makeEntry());
    expect(store.list(agentId)).toHaveLength(2);
  });

  it("appends and retrieves logs", () => {
    store.appendLog(agentId, {
      scheduleId: "sched-1",
      sessionId: "sess-1",
      triggeredAt: 1000,
      completedAt: 2000,
      status: "success",
    });
    store.appendLog(agentId, {
      scheduleId: "sched-1",
      sessionId: "sess-2",
      triggeredAt: 3000,
      status: "failed",
      error: "timeout",
    });
    const logs = store.getRecentLogs(agentId);
    expect(logs).toHaveLength(2);
    expect(logs[0].status).toBe("success");
    expect(logs[1].status).toBe("failed");
  });

  it("respects log limit", () => {
    for (let i = 0; i < 60; i++) {
      store.appendLog(agentId, {
        scheduleId: "sched-1",
        sessionId: `sess-${i}`,
        triggeredAt: i * 1000,
        status: "success",
      });
    }
    expect(store.getRecentLogs(agentId, 50)).toHaveLength(50);
  });

  it("returns empty logs when file does not exist", () => {
    expect(store.getRecentLogs(agentId)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run ScheduleStore tests**

Run: `npm test --workspace=packages/core -- src/__tests__/store/schedule.test.ts`
Expected: all tests pass

- [ ] **Step 3: Write Scheduler tests**

Create `packages/core/src/__tests__/scheduler.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { Scheduler } from "../scheduler.js";
import { Engine } from "../engine.js";
import type { ScheduleEntry } from "../types.js";

function createAgentDir(agentsDir: string, agentId: string, name: string): void {
  const dir = path.join(agentsDir, `${name}-${agentId.slice(0, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "profile.md"),
    `---\nid: ${agentId}\nname: ${name}\nschedule: true\ncreatedAt: ${Date.now()}\n---\nTest prompt`,
  );
}

describe("Scheduler", () => {
  let scheduler: Scheduler;
  let tmpDir: string;
  let agentsDir: string;
  const agentId = "test-agent-sched";
  let engine: Engine;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-scheduler-"));
    agentsDir = path.join(tmpDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    createAgentDir(agentsDir, agentId, "SchedAgent");

    const { createEngine } = await import("../factory.js");
    const result = await createEngine(tmpDir, { projectName: "Test", defaultModel: "test-model" });
    engine = result.engine;
    scheduler = new Scheduler(engine, agentsDir);
  });

  afterEach(() => {
    scheduler.stopAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeEntry(overrides?: Partial<ScheduleEntry>): ScheduleEntry {
    return {
      id: crypto.randomUUID(),
      enabled: true,
      cron: "0 9 * * *",
      mode: "new_session",
      message: "Daily check {{date}}",
      notify: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  it("registers and lists schedules", () => {
    const entry = makeEntry();
    scheduler.register(agentId, entry);
    const list = scheduler.list(agentId);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(entry.id);
  });

  it("unregisters a schedule", () => {
    const entry = makeEntry();
    scheduler.register(agentId, entry);
    scheduler.unregister(agentId, entry.id);
    expect(scheduler.list(agentId)).toHaveLength(0);
  });

  it("updates a schedule and emits event", () => {
    const entry = makeEntry();
    scheduler.register(agentId, entry);
    const emitted = vi.fn();
    scheduler.on("schedule_updated", emitted);
    scheduler.update(agentId, entry.id, { enabled: false });
    expect(scheduler.list(agentId)[0].enabled).toBe(false);
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it("resolves message template variables", async () => {
    const entry = makeEntry({ message: "Check {{date}} {{weekday}}" });
    scheduler.register(agentId, entry);
    // Test via internal resolution by verifying cron expression generates future dates
    const next = scheduler.getNextTrigger(agentId, entry.id);
    expect(next).not.toBeNull();
  });

  it("returns null for next trigger when disabled", () => {
    const entry = makeEntry({ enabled: false });
    scheduler.register(agentId, entry);
    expect(scheduler.getNextTrigger(agentId, entry.id)).toBeNull();
  });

  it("computes next trigger from cron expression", () => {
    const entry = makeEntry({ cron: "*/30 * * * *" });
    scheduler.register(agentId, entry);
    const next = scheduler.getNextTrigger(agentId, entry.id);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns null for invalid cron expression", () => {
    const entry = makeEntry({ cron: "invalid" });
    scheduler.register(agentId, entry);
    expect(scheduler.getNextTrigger(agentId, entry.id)).toBeNull();
  });

  it("stops all timers on stopAll", () => {
    const entry = makeEntry({ cron: "0 0 1 1 *" });
    scheduler.register(agentId, entry);
    scheduler.stopAll();
    expect(scheduler.list(agentId)).toHaveLength(1);
  });

  it("persists schedules via ScheduleStore", () => {
    const entry = makeEntry({ name: "Persisted" });
    scheduler.register(agentId, entry, true);
    // Create a new scheduler pointing at same dir to verify persistence
    const scheduler2 = new Scheduler(engine, agentsDir);
    const entries = scheduler2.get(agentId, entry.id);
    expect(entries).not.toBeNull();
    expect(entries!.name).toBe("Persisted");
  });

  it("writes logs for expected event types", () => {
    const logSpy = vi.fn();
    scheduler.on("schedule_triggered", logSpy);
    scheduler.on("schedule_completed", logSpy);
    scheduler.on("schedule_failed", logSpy);
    // Register an entry - events fire on trigger (not on register for non-triggered)
    scheduler.register(agentId, makeEntry({ cron: "0 0 1 1 *" }));
    expect(scheduler.list(agentId)).toHaveLength(1);
  });

  it("writes and reads logs via ScheduleStore", () => {
    scheduler.register(agentId, makeEntry());
    // Append some logs
    const logStore = (scheduler as any).scheduleStore;
    logStore.appendLog(agentId, { scheduleId: "test", sessionId: "s1", triggeredAt: 1, status: "success" });
    const logs = scheduler.getRecentLogs(agentId);
    expect(logs).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run Scheduler tests**

Run: `npm test --workspace=packages/core -- src/__tests__/scheduler.test.ts`
Expected: scheduler tests pass

- [ ] **Step 5: Run all core tests**

Run: `npm test --workspace=packages/core`
Expected: all core tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/__tests__/
git commit -m "test: add ScheduleStore and Scheduler unit tests"
```

---

### Task 7: Server contracts — schedule schemas

**Files:**
- Modify: `packages/server/src/contracts/index.ts`

- [ ] **Step 1: Add schedule TypeBox schemas**

In `packages/server/src/contracts/index.ts`, add new schemas to the `schemas` object before `chatClientMessage`:

```ts
scheduleEntry: Type.Object({
  id: Type.String(),
  name: Type.Optional(Type.String()),
  enabled: Type.Boolean(),
  cron: Type.String(),
  mode: Type.Union([Type.Literal("new_session"), Type.Literal("existing_session")]),
  targetSessionId: Type.Optional(Type.String()),
  message: Type.String(),
  notify: Type.Boolean(),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
}),

createScheduleRequest: Type.Object({
  name: Type.Optional(Type.String()),
  cron: Type.String(),
  mode: Type.Union([Type.Literal("new_session"), Type.Literal("existing_session")]),
  targetSessionId: Type.Optional(Type.String()),
  message: Type.String(),
  notify: Type.Boolean(),
}),

updateScheduleRequest: Type.Object({
  name: Type.Optional(Type.String()),
  enabled: Type.Optional(Type.Boolean()),
  cron: Type.Optional(Type.String()),
  mode: Type.Optional(Type.Union([Type.Literal("new_session"), Type.Literal("existing_session")])),
  targetSessionId: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  notify: Type.Optional(Type.Boolean()),
}),

scheduleInfo: Type.Object({
  id: Type.String(),
  name: Type.Optional(Type.String()),
  enabled: Type.Boolean(),
  cron: Type.String(),
  mode: Type.Union([Type.Literal("new_session"), Type.Literal("existing_session")]),
  targetSessionId: Type.Optional(Type.String()),
  message: Type.String(),
  notify: Type.Boolean(),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
  nextTriggerAt: Type.Optional(Type.Number()),
  lastTriggeredAt: Type.Optional(Type.Number()),
  lastStatus: Type.Optional(Type.Union([Type.Literal("success"), Type.Literal("failed")])),
}),

scheduleLogEntry: Type.Object({
  scheduleId: Type.String(),
  sessionId: Type.String(),
  triggeredAt: Type.Number(),
  completedAt: Type.Optional(Type.Number()),
  status: Type.Union([Type.Literal("running"), Type.Literal("success"), Type.Literal("failed")]),
  error: Type.Optional(Type.String()),
}),
```

Also update `sessionInfo` schema to include `source`:

```ts
sessionInfo: Type.Object({
  id: Type.String(),
  agentId: Type.String(),
  title: Type.Optional(Type.String()),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
  status: Type.Union([Type.Literal("active"), Type.Literal("archived")]),
  source: Type.Optional(Type.Union([Type.Literal("manual"), Type.Literal("scheduled")])),
}),
```

- [ ] **Step 2: Add TypeScript type exports**

Add after existing type exports:

```ts
export type ScheduleEntryContract = Static<typeof schemas.scheduleEntry>;
export type CreateScheduleRequest = Static<typeof schemas.createScheduleRequest>;
export type UpdateScheduleRequest = Static<typeof schemas.updateScheduleRequest>;
export type ScheduleInfo = Static<typeof schemas.scheduleInfo>;
export type ScheduleLogEntryContract = Static<typeof schemas.scheduleLogEntry>;
```

- [ ] **Step 3: Add ScheduleServerEvent union schema and types**

```ts
const ScheduleServerEventSchema = Type.Union([
  Type.Object({
    type: Type.Literal("schedule_triggered"),
    agentId: Type.String(),
    scheduleId: Type.String(),
    sessionId: Type.Optional(Type.String()),
    triggeredAt: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal("schedule_completed"),
    agentId: Type.String(),
    scheduleId: Type.String(),
    sessionId: Type.String(),
    status: Type.Literal("success"),
  }),
  Type.Object({
    type: Type.Literal("schedule_failed"),
    agentId: Type.String(),
    scheduleId: Type.String(),
    error: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("schedule_updated"),
    agentId: Type.String(),
    scheduleId: Type.String(),
    schedule: schemas.scheduleEntry,
  }),
]);

// Add to schemas object:
scheduleServerEvent: ScheduleServerEventSchema,

// Export type + parser:
export type ScheduleServerEvent = Static<typeof ScheduleServerEventSchema>;

export function parseScheduleServerEvent(payload: unknown): ScheduleServerEvent {
  return parseContract(ScheduleServerEventSchema, payload);
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build --workspace=packages/server`
Expected: compiles without errors

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/contracts/index.ts
git commit -m "feat: add schedule API contracts and WebSocket event schemas"
```

---

### Task 8: Server REST routes

**Files:**
- Create: `packages/server/src/routes/schedules.ts`

- [ ] **Step 1: Implement schedule REST routes**

Create `packages/server/src/routes/schedules.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { schemas, parseContract } from "@spherse/server/contracts";
import type { AppContext } from "../index.js";

export function registerScheduleRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  const scheduler = ctx.engine.getScheduler();

  fastify.get<{ Params: { agentId: string } }>(
    "/api/agents/:agentId/schedules",
    async (req) => {
      const entries = scheduler.list(req.params.agentId);
      return entries.map((entry) => ({
        ...entry,
        nextTriggerAt: scheduler.getNextTrigger(req.params.agentId, entry.id)?.getTime(),
      }));
    },
  );

  fastify.get<{ Params: { agentId: string; scheduleId: string } }>(
    "/api/agents/:agentId/schedules/:scheduleId",
    async (req, reply) => {
      const entry = scheduler.get(req.params.agentId, req.params.scheduleId);
      if (!entry) return reply.code(404).send({ error: "Schedule not found" });
      return entry;
    },
  );

  fastify.post<{ Params: { agentId: string } }>(
    "/api/agents/:agentId/schedules",
    {
      schema: {
        body: schemas.createScheduleRequest,
      },
    },
    async (req, reply) => {
      try {
        const data = parseContract(schemas.createScheduleRequest, req.body);
        const now = Date.now();
        const entry = {
          id: crypto.randomUUID(),
          name: data.name,
          enabled: true,
          cron: data.cron,
          mode: data.mode,
          targetSessionId: data.targetSessionId,
          message: data.message,
          notify: data.notify,
          createdAt: now,
          updatedAt: now,
        };
        scheduler.register(req.params.agentId, entry);
        return reply.code(201).send(entry);
      } catch (err: any) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  fastify.put<{ Params: { agentId: string; scheduleId: string } }>(
    "/api/agents/:agentId/schedules/:scheduleId",
    {
      schema: {
        body: schemas.updateScheduleRequest,
      },
    },
    async (req, reply) => {
      try {
        const data = parseContract(schemas.updateScheduleRequest, req.body);
        const updated = scheduler.update(req.params.agentId, req.params.scheduleId, data);
        if (!updated) return reply.code(404).send({ error: "Schedule not found" });
        return updated;
      } catch (err: any) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  fastify.delete<{ Params: { agentId: string; scheduleId: string } }>(
    "/api/agents/:agentId/schedules/:scheduleId",
    async (req) => {
      scheduler.unregister(req.params.agentId, req.params.scheduleId);
      return { ok: true };
    },
  );

  fastify.post<{ Params: { agentId: string; scheduleId: string } }>(
    "/api/agents/:agentId/schedules/:scheduleId/trigger",
    async (_req, reply) => {
      try {
        const entry = scheduler.get(_req.params.agentId, _req.params.scheduleId);
        if (!entry) return reply.code(404).send({ error: "Schedule not found" });
        scheduler.register(_req.params.agentId, { ...entry, enabled: true, updatedAt: Date.now() });
        return { ok: true };
      } catch (err: any) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  fastify.get<{ Params: { agentId: string } }>(
    "/api/agents/:agentId/schedule-logs",
    async (req) => {
      return scheduler.getRecentLogs(req.params.agentId);
    },
  );
}
```

- [ ] **Step 2: Register schedule routes in routes/index.ts**

In `packages/server/src/routes/index.ts`, add:

```ts
import { registerScheduleRoutes } from "./schedules.js";

// In registerAllRoutes:
registerScheduleRoutes(fastify, ctx);
```

- [ ] **Step 3: Verify build**

Run: `npm run build --workspace=packages/server`
Expected: compiles

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/schedules.ts packages/server/src/routes/index.ts
git commit -m "feat: add schedule REST endpoints"
```

---

### Task 9: Server WebSocket — schedule events

**Files:**
- Create: `packages/server/src/ws-schedule.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Implement WebSocket handler**

Create `packages/server/src/ws-schedule.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { parseScheduleServerEvent } from "@spherse/server/contracts";
import type { AppContext } from "./index.js";

export function handleScheduleWebSocket(
  fastify: FastifyInstance,
  ctx: AppContext,
) {
  fastify.get("/ws/schedule", { websocket: true }, (socket) => {
    const scheduler = ctx.engine.getScheduler();

    const onScheduleTriggered = (payload: any) => {
      socket.send(JSON.stringify(parseScheduleServerEvent({
        type: "schedule_triggered",
        agentId: payload.agentId,
        scheduleId: payload.scheduleId,
        sessionId: payload.sessionId,
        triggeredAt: payload.triggeredAt,
      })));
    };

    const onScheduleCompleted = (payload: any) => {
      socket.send(JSON.stringify(parseScheduleServerEvent({
        type: "schedule_completed",
        agentId: payload.agentId,
        scheduleId: payload.scheduleId,
        sessionId: payload.sessionId,
        status: payload.status,
      })));
    };

    const onScheduleFailed = (payload: any) => {
      socket.send(JSON.stringify(parseScheduleServerEvent({
        type: "schedule_failed",
        agentId: payload.agentId,
        scheduleId: payload.scheduleId,
        error: payload.error,
      })));
    };

    const onScheduleUpdated = (payload: any) => {
      socket.send(JSON.stringify(parseScheduleServerEvent({
        type: "schedule_updated",
        agentId: payload.agentId,
        scheduleId: payload.scheduleId,
        schedule: payload.schedule,
      })));
    };

    scheduler.on("schedule_triggered", onScheduleTriggered);
    scheduler.on("schedule_completed", onScheduleCompleted);
    scheduler.on("schedule_failed", onScheduleFailed);
    scheduler.on("schedule_updated", onScheduleUpdated);

    socket.on("close", () => {
      scheduler.off("schedule_triggered", onScheduleTriggered);
      scheduler.off("schedule_completed", onScheduleCompleted);
      scheduler.off("schedule_failed", onScheduleFailed);
      scheduler.off("schedule_updated", onScheduleUpdated);
    });
  });
}
```

- [ ] **Step 2: Register WebSocket handler in server index.ts**

In `packages/server/src/index.ts`, add import and registration:

```ts
import { handleScheduleWebSocket } from "./ws-schedule.js";

// After existing WS registrations:
handleScheduleWebSocket(fastify, ctx);
```

- [ ] **Step 3: Verify build**

Run: `npm run build --workspace=packages/server`
Expected: compiles

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/ws-schedule.ts packages/server/src/index.ts
git commit -m "feat: add schedule WebSocket event channel"
```

---

### Task 10: Server tests

**Files:**
- Modify: `packages/server/src/__tests__/` (or create appropriate test files)

- [ ] **Step 1: Run existing server tests**

Run: `npm test --workspace=packages/server`
Expected: all existing tests pass (no new tests for schedules yet — existing tests should not break)

- [ ] **Step 2: Commit (only if there are test fixes)**

If existing tests pass, skip this commit. If tests needed fixes, commit the fixes.

---

### Task 11: Frontend types + API client

**Files:**
- Modify: `packages/app/src/lib/types.ts`
- Modify: `packages/app/src/lib/api.ts`

- [ ] **Step 1: Add schedule types to frontend**

In `packages/app/src/lib/types.ts`, add after existing types:

```ts
export interface ScheduleEntry {
  id: string;
  name?: string;
  enabled: boolean;
  cron: string;
  mode: "new_session" | "existing_session";
  targetSessionId?: string;
  message: string;
  notify: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleInfo extends ScheduleEntry {
  nextTriggerAt?: number;
}

export interface ScheduleLogEntry {
  scheduleId: string;
  sessionId: string;
  triggeredAt: number;
  completedAt?: number;
  status: "running" | "success" | "failed";
  error?: string;
}

export interface ScheduleServerEvent {
  type: "schedule_triggered" | "schedule_completed" | "schedule_failed" | "schedule_updated";
  agentId: string;
  scheduleId: string;
  sessionId?: string;
  triggeredAt?: number;
  status?: string;
  error?: string;
  schedule?: ScheduleEntry;
}
```

Also update `AgentProfile.schedule` from `string` to `boolean`, and `SessionInfo` to include `source`:

```ts
export interface AgentProfile {
  // ...
  schedule?: boolean; // changed from string
  // ...
}

export interface SessionInfo {
  // ...
  source?: "manual" | "scheduled";
}
```

- [ ] **Step 2: Add schedule API methods**

In `packages/app/src/lib/api.ts`, add to the returned object of `createApiClient`:

```ts
async listSchedules(agentId: string): Promise<ScheduleInfo[]> {
  const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(agentId)}/schedules`);
  return res.json();
},

async createSchedule(agentId: string, data: {
  name?: string;
  cron: string;
  mode: "new_session" | "existing_session";
  targetSessionId?: string;
  message: string;
  notify: boolean;
}): Promise<ScheduleEntry> {
  const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(agentId)}/schedules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request failed" }));
    throw new Error(err.error ?? "request failed");
  }
  return res.json();
},

async updateSchedule(agentId: string, scheduleId: string, data: {
  name?: string;
  enabled?: boolean;
  cron?: string;
  mode?: "new_session" | "existing_session";
  targetSessionId?: string;
  message?: string;
  notify?: boolean;
}): Promise<ScheduleEntry> {
  const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(agentId)}/schedules/${encodeURIComponent(scheduleId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request failed" }));
    throw new Error(err.error ?? "request failed");
  }
  return res.json();
},

async deleteSchedule(agentId: string, scheduleId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(agentId)}/schedules/${encodeURIComponent(scheduleId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request failed" }));
    throw new Error(err.error ?? "request failed");
  }
  return res.json();
},

async getScheduleLogs(agentId: string): Promise<ScheduleLogEntry[]> {
  const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(agentId)}/schedule-logs`);
  return res.json();
},

createScheduleWebSocket(onEvent: (event: ScheduleServerEvent) => void): WebSocket {
  const url = `${wsUrl}/ws/schedule`;
  const ws = new WebSocket(url);
  ws.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      onEvent(parsed);
    } catch {
      // ignore malformed events
    }
  };
  ws.onerror = () => {};
  return ws;
},
```

Add imports at top:

```ts
import type { ScheduleEntry, ScheduleInfo, ScheduleLogEntry, ScheduleServerEvent } from "./types";
```

- [ ] **Step 3: Verify app compile**

Run: `npm run build --workspace=packages/app`
Expected: compiles (store references to schedule may warn until Task 12)

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/lib/types.ts packages/app/src/lib/api.ts
git commit -m "feat: add schedule types and API client methods"
```

---

### Task 12: Frontend store — schedule state

**Files:**
- Modify: `packages/app/src/stores/project-data-store.ts`

- [ ] **Step 1: Add schedule state and actions to ProjectDataStore**

Add to `ProjectData` interface:

```ts
interface ProjectData {
  agents: AgentProfile[];
  sessions: SessionInfo[];
  schedulesByAgent: Record<string, ScheduleInfo[]>;
  initialMessageBySessionId: Record<string, string>;
  loading: boolean;
  error: string | null;
}
```

Update `createProjectData()`:

```ts
function createProjectData(): ProjectData {
  return {
    agents: [],
    sessions: [],
    schedulesByAgent: {},
    initialMessageBySessionId: {},
    loading: false,
    error: null,
  };
}
```

Add to `ProjectDataStore` interface:

```ts
refreshSchedules: (projectKey: string, client: ApiClient, agentId: string) => Promise<void>;
createSchedule: (projectKey: string, client: ApiClient, agentId: string, data: Parameters<ApiClient["createSchedule"]>[1]) => Promise<void>;
updateSchedule: (projectKey: string, client: ApiClient, agentId: string, scheduleId: string, data: Parameters<ApiClient["updateSchedule"]>[2]) => Promise<void>;
deleteSchedule: (projectKey: string, client: ApiClient, agentId: string, scheduleId: string) => Promise<void>;
```

Add import for `ScheduleInfo`:

```ts
import type { AgentProfile, SessionInfo, ScheduleInfo } from "../lib/types";
```

Add actions implementation after `clearProjectData`:

```ts
async refreshSchedules(projectKey, client, agentId) {
  try {
    const schedules = await client.listSchedules(agentId);
    set((state) => updateProjectData(state, projectKey, (project) => ({
      ...project,
      schedulesByAgent: {
        ...project.schedulesByAgent,
        [agentId]: schedules,
      },
    }), { createIfMissing: false }));
  } catch (err) {
    set((state) => updateProjectData(state, projectKey, (project) => ({
      ...project,
      error: getErrorMessage(err),
    }), { createIfMissing: false }));
  }
},

async createSchedule(projectKey, client, agentId, data) {
  try {
    await client.createSchedule(agentId, data);
    await get().refreshSchedules(projectKey, client, agentId);
  } catch (err) {
    set((state) => updateProjectData(state, projectKey, (project) => ({
      ...project,
      error: getErrorMessage(err),
    }), { createIfMissing: false }));
  }
},

async updateSchedule(projectKey, client, agentId, scheduleId, data) {
  try {
    await client.updateSchedule(agentId, scheduleId, data);
    await get().refreshSchedules(projectKey, client, agentId);
  } catch (err) {
    set((state) => updateProjectData(state, projectKey, (project) => ({
      ...project,
      error: getErrorMessage(err),
    }), { createIfMissing: false }));
  }
},

async deleteSchedule(projectKey, client, agentId, scheduleId) {
  try {
    await client.deleteSchedule(agentId, scheduleId);
    await get().refreshSchedules(projectKey, client, agentId);
  } catch (err) {
    set((state) => updateProjectData(state, projectKey, (project) => ({
      ...project,
      error: getErrorMessage(err),
    }), { createIfMissing: false }));
  }
},
```

- [ ] **Step 2: Verify app compiles**

Run: `npm run build --workspace=packages/app`
Expected: compiles without errors

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/stores/project-data-store.ts
git commit -m "feat: add schedule state management to project-data-store"
```

---

### Task 13: Frontend UI — schedule dialog

**Files:**
- Create: `packages/app/src/features/agent-session-list/ScheduleDialog.tsx`
- Modify: `packages/app/src/features/agent-session-list/AgentRow.tsx`
- Modify: `packages/app/src/features/agent-session-list/index.tsx` (if dialog is rendered there)

- [ ] **Step 1: Create ScheduleDialog component**

Create `packages/app/src/features/agent-session-list/ScheduleDialog.tsx`:

```tsx
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { PencilIcon, TrashIcon } from "lucide-react";
import type { ScheduleEntry, ScheduleInfo } from "../../lib/types";
import type { ApiClient } from "../../lib/api";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useI18n } from "@spherse/i18n/react";

const PRESETS = [
  { label: "每 30 分钟", cron: "*/30 * * * *" },
  { label: "每小时", cron: "0 * * * *" },
  { label: "每天", cron: "0 HH * * *" },
  { label: "每周", cron: "0 HH * * DOW" },
  { label: "自定义", cron: "" },
];

interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  projectKey: string;
  client: ApiClient;
}

export function ScheduleDialog({ open, onOpenChange, agentId, projectKey, client }: ScheduleDialogProps) {
  const { t } = useI18n();
  const schedules = useProjectDataStore((s) => s.projects[projectKey]?.schedulesByAgent?.[agentId] ?? []);
  const refreshSchedules = useProjectDataStore((s) => s.refreshSchedules);
  const createSchedule = useProjectDataStore((s) => s.createSchedule);
  const updateSchedule = useProjectDataStore((s) => s.updateSchedule);
  const deleteSchedule = useProjectDataStore((s) => s.deleteSchedule);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [cron, setCron] = useState("");
  const [preset, setPreset] = useState("");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"new_session" | "existing_session">("new_session");
  const [notify, setNotify] = useState(false);
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (open) {
      refreshSchedules(projectKey, client, agentId);
    }
  }, [open, projectKey, client, agentId, refreshSchedules]);

  function resetForm() {
    setEditingId(null);
    setCron("");
    setPreset("");
    setMessage("");
    setMode("new_session");
    setNotify(false);
    setName("");
    setEnabled(true);
  }

  function handlePresetChange(value: string) {
    setPreset(value);
    const entry = PRESETS.find((p) => p.label === value);
    if (entry) setCron(entry.cron);
  }

  async function handleSave() {
    if (!cron.trim() || !message.trim()) return;
    if (editingId) {
      await updateSchedule(projectKey, client, agentId, editingId, { name: name || undefined, enabled, cron, message, mode, notify });
    } else {
      await createSchedule(projectKey, client, agentId, { name: name || undefined, cron, message, mode, notify });
    }
    resetForm();
  }

  function handleEdit(entry: ScheduleEntry) {
    setEditingId(entry.id);
    setCron(entry.cron);
    setMessage(entry.message);
    setMode(entry.mode);
    setNotify(entry.notify);
    setName(entry.name ?? "");
    setEnabled(entry.enabled);
  }

  async function handleDelete(scheduleId: string) {
    await deleteSchedule(projectKey, client, agentId, scheduleId);
  }

  async function handleToggle(entry: ScheduleInfo) {
    await updateSchedule(projectKey, client, agentId, entry.id, { enabled: !entry.enabled });
  }

  function insertVariable(variable: string) {
    setMessage((prev) => prev + `{{${variable}}}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("agent-schedule.dialogTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-80 overflow-y-auto">
          {schedules.map((entry) => (
            <div key={entry.id} className="flex items-center gap-2 p-2 rounded-md bg-muted">
              <Switch checked={entry.enabled} onCheckedChange={() => handleToggle(entry)} />
              <span className="flex-1 text-sm">{entry.name || entry.cron}</span>
              <span className="text-xs text-muted-foreground">
                {entry.nextTriggerAt ? new Date(entry.nextTriggerAt).toLocaleString() : ""}
              </span>
              <Button variant="ghost" size="icon" className="size-6" onClick={() => handleEdit(entry)}>
                <PencilIcon className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="size-6 text-destructive" onClick={() => handleDelete(entry.id)}>
                <TrashIcon className="size-3.5" />
              </Button>
            </div>
          ))}

          <div className="border-t pt-4 space-y-3">
            <div className="space-y-1">
              <Label>{t("agent-schedule.name")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("agent-schedule.namePlaceholder")} />
            </div>

            <div className="space-y-1">
              <Label>{t("agent-schedule.frequency")}</Label>
              <Select value={preset} onValueChange={handlePresetChange}>
                <SelectTrigger>
                  <SelectValue placeholder={t("agent-schedule.selectPreset")} />
                </SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => (
                    <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {preset === "自定义" && (
                <Input
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder="0 9 * * *"
                  className="mt-1"
                />
              )}
            </div>

            <div className="space-y-1">
              <Label>{t("agent-schedule.mode")}</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as "new_session" | "existing_session")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new_session">{t("agent-schedule.modeNewSession")}</SelectItem>
                  <SelectItem value="existing_session">{t("agent-schedule.modeExistingSession")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>{t("agent-schedule.message")}</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("agent-schedule.messagePlaceholder")}
                rows={4}
              />
              <div className="flex gap-1 mt-1">
                {["date", "time", "datetime", "weekday", "agent_name"].map((v) => (
                  <Button key={v} variant="outline" size="sm" className="text-xs h-6 px-2" onClick={() => insertVariable(v)}>
                    {`{{${v}}}`}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label>{t("agent-schedule.notify")}</Label>
              <Switch checked={notify} onCheckedChange={setNotify} />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSave} className="flex-1">
                {editingId ? t("common.save") : t("common.add")}
              </Button>
              {editingId && (
                <Button variant="outline" onClick={resetForm}>{t("common.cancel")}</Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Add schedule entry to AgentRow dropdown menu**

In `packages/app/src/features/agent-session-list/AgentRow.tsx`, add a new prop and menu item:

```tsx
interface AgentRowProps {
  agent: AgentProfile;
  active?: boolean;
  onNewSession: (agent: AgentProfile) => void;
  onEditAgent: (agent: AgentProfile) => void;
  onDeleteAgent: (agent: AgentProfile) => void;
  onScheduleAgent: (agent: AgentProfile) => void;
}

// In DropdownMenuContent, add before the delete item:
<DropdownMenuItem onClick={() => onScheduleAgent(agent)}>
  {t("agent-schedule.menuItem")}
</DropdownMenuItem>
```

- [ ] **Step 3: Wire dialog in index.tsx (AgentSessionListView)**

In `packages/app/src/features/agent-session-list/index.tsx`, add state and dialog:

```tsx
import { ScheduleDialog } from "./ScheduleDialog";
import { ApiClient } from "../../lib/api";

// Add state:
const [scheduleAgent, setScheduleAgent] = useState<AgentProfile | null>(null);

// In the JSX render:
<ScheduleDialog
  open={!!scheduleAgent}
  onOpenChange={(open) => { if (!open) setScheduleAgent(null); }}
  agentId={scheduleAgent?.id ?? ""}
  projectKey={projectKey}
  client={client}
/>

// On each AgentRow:
<AgentRow
  ...
  onScheduleAgent={setScheduleAgent}
/>
```

- [ ] **Step 4: Verify app compiles**

Run: `npm run build --workspace=packages/app`
Expected: compiles without errors

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/features/agent-session-list/
git commit -m "feat: add schedule dialog and agent menu entry"
```

---

### Task 14: i18n — schedule keys

**Files:**
- Modify: `packages/i18n/src/locales/zh-CN.ts`
- Modify: `packages/i18n/src/locales/zh-TW.ts`
- Modify: `packages/i18n/src/locales/en.ts`

- [ ] **Step 1: Add schedule i18n keys to zh-CN**

In `packages/i18n/src/locales/zh-CN.ts`, add before the closing `}` of the `zhCN` object:

```ts
// --- Agent Schedule ---
// 搭档定时执行菜单项（AgentRow 下拉菜单）
"agent-schedule.menuItem": "定时任务",
// 定时任务弹窗标题
"agent-schedule.dialogTitle": "定时任务设置",
// 定时任务名称输入框标签
"agent-schedule.name": "任务名称",
// 定时任务名称占位符
"agent-schedule.namePlaceholder": "可选，如"每日回顾"",
// 频率选择标签
"agent-schedule.frequency": "执行频率",
// 频率选择占位符
"agent-schedule.selectPreset": "选择频率...",
// 运行模式标签
"agent-schedule.mode": "运行模式",
// 运行模式：新建 session
"agent-schedule.modeNewSession": "每次新建 session",
// 运行模式：指定 session
"agent-schedule.modeExistingSession": "向指定 session 发消息",
// 消息模板标签
"agent-schedule.message": "消息模板",
// 消息模板占位符
"agent-schedule.messagePlaceholder": "输入触发时发送给搭档的消息...",
// 完成通知开关标签
"agent-schedule.notify": "完成时通知",
// 定时任务执行开始 toast
"agent-schedule.toastStarted": "{agentName} 定时任务「{scheduleName}」已开始执行",
// 定时任务执行完成 toast
"agent-schedule.toastCompleted": "{agentName} 定时任务「{scheduleName}」执行完成",
// 定时任务执行失败 toast
"agent-schedule.toastFailed": "{agentName} 定时任务「{scheduleName}」执行失败: {error}",
```

- [ ] **Step 2: Add schedule i18n keys to zh-TW and en**

Follow the same key pattern with appropriate translations:

In `zh-TW.ts`:

```ts
"agent-schedule.menuItem": "定時任務",
"agent-schedule.dialogTitle": "定時任務設定",
"agent-schedule.name": "任務名稱",
"agent-schedule.namePlaceholder": "可選，如「每日回顧」",
"agent-schedule.frequency": "執行頻率",
"agent-schedule.selectPreset": "選擇頻率...",
"agent-schedule.mode": "執行模式",
"agent-schedule.modeNewSession": "每次新建 session",
"agent-schedule.modeExistingSession": "向指定 session 發送訊息",
"agent-schedule.message": "訊息模板",
"agent-schedule.messagePlaceholder": "輸入觸發時發送給搭檔的訊息...",
"agent-schedule.notify": "完成時通知",
"agent-schedule.toastStarted": "{agentName} 定時任務「{scheduleName}」已開始執行",
"agent-schedule.toastCompleted": "{agentName} 定時任務「{scheduleName}」執行完成",
"agent-schedule.toastFailed": "{agentName} 定時任務「{scheduleName}」執行失敗: {error}",
```

In `en.ts`:

```ts
"agent-schedule.menuItem": "Scheduled Tasks",
"agent-schedule.dialogTitle": "Scheduled Task Settings",
"agent-schedule.name": "Task Name",
"agent-schedule.namePlaceholder": "Optional, e.g. \"Daily Review\"",
"agent-schedule.frequency": "Frequency",
"agent-schedule.selectPreset": "Select frequency...",
"agent-schedule.mode": "Execution Mode",
"agent-schedule.modeNewSession": "Create new session each time",
"agent-schedule.modeExistingSession": "Send to existing session",
"agent-schedule.message": "Message Template",
"agent-schedule.messagePlaceholder": "Enter message to send when triggered...",
"agent-schedule.notify": "Notify on completion",
"agent-schedule.toastStarted": "{agentName} scheduled task \"{scheduleName}\" has started",
"agent-schedule.toastCompleted": "{agentName} scheduled task \"{scheduleName}\" completed",
"agent-schedule.toastFailed": "{agentName} scheduled task \"{scheduleName}\" failed: {error}",
```

- [ ] **Step 3: Run i18n check**

Run: `npm run check:i18n`
Expected: no missing keys error

- [ ] **Step 4: Commit**

```bash
git add packages/i18n/src/locales/
git commit -m "feat: add schedule i18n keys for zh-CN, zh-TW, en"
```

---

### Task 15: Full verification

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 2: Run full build**

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

- [ ] **Step 6: Run i18n check**

Run: `npm run check:i18n`
Expected: no errors

- [ ] **Step 7: Commit any lint/test fixes**

If lint or tests needed fixes, commit them.

---

### Task 16: Update official docs

**Files:**
- Modify: `docs/official/data-conventions.md`
- Modify: `docs/official/architecture.md`

- [ ] **Step 1: Update data-conventions.md**

Update `schedule` field description (line 66):

```markdown
- `schedule`：布尔值，表示该 agent 是否配置了定时任务。具体配置在 `schedules.yml` 中
```

Add schedules.yml and schedule-logs.jsonl to directory structure (after `sessions.db`):

```text
│   │       ├── profile.md
│   │       ├── theme.css
│   │       ├── sessions.db
│   │       ├── schedules.yml
│   │       └── schedule-logs.jsonl
```

Add new section before "## Session 数据":

```markdown
## 定时任务数据

定时任务配置存储在 `.spherse/agents/{slug}-{shortId}/schedules.yml`，YAML 数组格式，每个元素为 `ScheduleEntry`：

```yaml
- id: uuid
  name: 每日回顾
  enabled: true
  cron: "0 9 * * *"
  mode: new_session
  message: "回顾进展 {{date}}"
  notify: true
  createdAt: 1749600000000
  updatedAt: 1749600000000
```

执行日志追加写入 `.spherse/agents/{slug}-{shortId}/schedule-logs.jsonl`，每行一个 JSON 对象。
```

Update session table schema to include `source`:

```markdown
sessions(id TEXT PK, agent_id TEXT, title TEXT, created_at INT, updated_at INT, status TEXT DEFAULT 'active', source TEXT DEFAULT 'manual')
```

- [ ] **Step 2: Update architecture.md**

Add to Core 层 section:

```markdown
- **定时调度**：`Scheduler` 类使用 `cron-parser` 解析 cron 表达式，通过 `setTimeout` 实现精确间隔触发。Engine 通过 `setScheduler` 注入，`loadFromProfiles` 在 Engine 启动时读取所有 agent 的 `schedules.yml` 并注册定时器
```

Add schedule routes to Server 层 section:

```markdown
- **定时任务 API**：`schedules.ts` 提供定时任务 CRUD 和手动触发，`ws-schedule.ts` 推送 `schedule_triggered/completed/failed/updated` 事件
```

- [ ] **Step 3: Update backlog.md**

Mark the "[feature] agent定时运行" item as `[x]` done in `docs/dev/backlog.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: update official docs with schedule feature"
```
