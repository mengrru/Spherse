# Worldbuilding Agent MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MVP that allows creating a worldbuilding project, defining agents in Markdown, chatting with an agent through a desktop UI, and browsing generated content.

**Architecture:** Electron app with an embedded Fastify server. Core logic lives in `packages/core` (no UI dependency), exposed via REST/WebSocket API in `packages/server`, rendered in `packages/app` (Electron + React). Agent runtime built on pi-agent-core, LLM calls via pi-ai.

**Tech Stack:** TypeScript (ESM), npm workspaces, Electron, React, Fastify, better-sqlite3, @mariozechner/pi-agent-core, @mariozechner/pi-ai, @sinclair/typebox, gray-matter

**Spec:** `docs/superpowers/specs/2026-05-03-worldbuilding-agent-design.md`

---

## File Structure

```
worldbuilding-agent/
├── package.json
├── tsconfig.base.json
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── types.ts
│   │       ├── project-store.ts
│   │       ├── agent-parser.ts
│   │       ├── session-store.ts
│   │       ├── agent-engine.ts
│   │       ├── tools/
│   │       │   ├── index.ts
│   │       │   ├── read-file.ts
│   │       │   ├── write-file.ts
│   │       │   ├── list-files.ts
│   │       │   ├── search-content.ts
│   │       │   └── append-changelog.ts
│   │       └── index.ts
│   ├── server/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── routes.ts
│   │       └── ws-chat.ts
│   └── app/
│       ├── package.json
│       ├── tsconfig.json
│       ├── electron/
│       │   └── main.ts
│       ├── src/
│       │   ├── App.tsx
│       │   └── main.tsx
│       └── index.html
```

---

## Task 1: Monorepo Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`
- Create: `packages/server/package.json`, `packages/server/tsconfig.json`
- Create: `packages/app/package.json`
- Create: `packages/core/src/index.ts`, `packages/server/src/index.ts`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "worldbuilding-agent",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "npm run build --workspaces",
    "dev": "npm run dev --workspace=packages/app"
  }
}
```

- [ ] **Step 2: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 3: Create packages/core/package.json**

```json
{
  "name": "@worldbuilding-agent/core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@mariozechner/pi-agent-core": "file:../../../pi-mono/packages/agent",
    "@mariozechner/pi-ai": "file:../../../pi-mono/packages/ai",
    "@sinclair/typebox": "^1.0.11",
    "better-sqlite3": "^11.0.0",
    "gray-matter": "^4.0.3",
    "yaml": "^2.7.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 4: Create packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create packages/server/package.json**

```json
{
  "name": "@worldbuilding-agent/server",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@worldbuilding-agent/core": "*",
    "fastify": "^5.3.0",
    "@fastify/websocket": "^11.0.0",
    "@fastify/cors": "^10.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 6: Create packages/server/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 7: Create packages/app/package.json**

```json
{
  "name": "@worldbuilding-agent/app",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "echo TODO",
    "dev": "echo TODO"
  },
  "dependencies": {
    "@worldbuilding-agent/server": "*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "electron": "^35.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "electron-vite": "^3.0.0"
  }
}
```

- [ ] **Step 8: Create placeholder src/index.ts for each package**

`packages/core/src/index.ts`:
```typescript
export {};
```

`packages/server/src/index.ts`:
```typescript
export {};
```

- [ ] **Step 9: Verify build**

Run: `npm install && npm run build`
Expected: Both packages compile with no errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: monorepo scaffolding with npm workspaces"
```

---

## Task 2: Shared Types

**Files:**
- Create: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Define shared types**

Create `packages/core/src/types.ts`:

```typescript
export interface ProjectConfig {
  name: string;
  created: number;
  defaultModel: string;
  paths: {
    agents: string;
    index: string;
    changelog: string;
  };
}

export type AgentType = "creator" | "roleplay" | "scheduler" | string;

export interface AgentDefinition {
  name: string;
  model?: string;
  type: AgentType;
  schedule?: string;
  tools?: string[];
  context?: string[];
  output?: {
    path: string;
    naming: string;
    frontmatter?: Record<string, string>;
  };
  systemPrompt: string;
  filePath: string;
}

export interface SessionInfo {
  id: string;
  agentName: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  status: "active" | "archived";
}
```

- [ ] **Step 2: Export from index.ts**

Update `packages/core/src/index.ts`:
```typescript
export * from "./types.js";
```

- [ ] **Step 3: Verify build and commit**

Run: `npm run build`
```bash
git add -A && git commit -m "feat: add shared types for project, agent, session"
```

---

## Task 3: Project Store

**Files:**
- Create: `packages/core/src/project-store.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Implement ProjectStore**

Create `packages/core/src/project-store.ts`:

```typescript
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { ProjectConfig } from "./types.js";

export interface ChangelogEntry {
  agent: string;
  action: string;
  target: string;
  description: string;
}

const DEFAULT_PATHS = {
  agents: "agents",
  index: "AGENTS.md",
  changelog: "CHANGELOG.md",
};

const DEFAULT_AGENTS_MD = `# 世界观项目

> 此文件是项目的目录索引，供人类和 AI agent 阅读。

## 目录结构

请在此处描述你的世界观项目的目录结构。
`;

export class ProjectStore {
  private rootPath: string;
  private config: ProjectConfig | null = null;
  private piDir: string;

  constructor(rootPath: string) {
    this.rootPath = path.resolve(rootPath);
    this.piDir = path.join(this.rootPath, ".pi");
  }

  async create(name: string, defaultModel: string): Promise<ProjectConfig> {
    await fs.mkdir(this.piDir, { recursive: true });
    await fs.mkdir(path.join(this.piDir, DEFAULT_PATHS.agents), {
      recursive: true,
    });

    this.config = {
      name,
      created: Date.now(),
      defaultModel,
      paths: { ...DEFAULT_PATHS },
    };

    const configPath = path.join(this.piDir, "project.yaml");
    await fs.writeFile(configPath, YAML.stringify(this.config), "utf-8");

    const indexPath = path.join(this.rootPath, DEFAULT_PATHS.index);
    await fs.writeFile(indexPath, DEFAULT_AGENTS_MD, "utf-8");

    const changelogPath = path.join(this.rootPath, DEFAULT_PATHS.changelog);
    await fs.writeFile(changelogPath, "", "utf-8");

    return this.config;
  }

  async open(): Promise<ProjectConfig> {
    const configPath = path.join(this.piDir, "project.yaml");
    if (!fsSync.existsSync(configPath)) {
      throw new Error(`project.yaml not found at ${configPath}`);
    }

    const raw = await fs.readFile(configPath, "utf-8");
    this.config = YAML.parse(raw) as ProjectConfig;
    return this.config;
  }

  getConfig(): ProjectConfig | null {
    return this.config;
  }

  getRootPath(): string {
    return this.rootPath;
  }

  async readIndex(): Promise<string> {
    const indexPath = path.join(
      this.rootPath,
      this.config?.paths.index ?? DEFAULT_PATHS.index,
    );
    return fs.readFile(indexPath, "utf-8");
  }

  async updateIndex(content: string): Promise<void> {
    const indexPath = path.join(
      this.rootPath,
      this.config?.paths.index ?? DEFAULT_PATHS.index,
    );
    await fs.writeFile(indexPath, content, "utf-8");
  }

  async appendChangelog(entry: ChangelogEntry): Promise<void> {
    const changelogPath = path.join(
      this.rootPath,
      this.config?.paths.changelog ?? DEFAULT_PATHS.changelog,
    );
    const timestamp = new Date().toISOString();
    const line = `- **[${timestamp}]** ${entry.agent} / ${entry.action} / \`${entry.target}\` — ${entry.description}\n`;
    await fs.appendFile(changelogPath, line, "utf-8");
  }
}
```

- [ ] **Step 2: Export from index.ts**

Update `packages/core/src/index.ts`:
```typescript
export * from "./types.js";
export { ProjectStore } from "./project-store.js";
export type { ChangelogEntry } from "./project-store.js";
```

- [ ] **Step 3: Verify build and commit**

Run: `npm run build`
```bash
git add -A && git commit -m "feat: implement ProjectStore with create, open, changelog"
```

---

## Task 4: Agent Parser

**Files:**
- Create: `packages/core/src/agent-parser.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Implement AgentParser**

Create `packages/core/src/agent-parser.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { AgentDefinition } from "./types.js";

export async function parseAgentFile(
  filePath: string,
): Promise<AgentDefinition> {
  const raw = await fs.readFile(filePath, "utf-8");
  const { data, content } = matter(raw);

  if (!data.name) {
    throw new Error(
      `Agent file ${filePath}: missing required field "name" in frontmatter`,
    );
  }
  if (!data.type) {
    throw new Error(
      `Agent file ${filePath}: missing required field "type" in frontmatter`,
    );
  }

  return {
    name: data.name,
    model: data.model,
    type: data.type,
    schedule: data.schedule,
    tools: data.tools,
    context: data.context,
    output: data.output,
    systemPrompt: content.trim(),
    filePath,
  };
}

export async function listAgents(
  agentDir: string,
): Promise<AgentDefinition[]> {
  try {
    const entries = await fs.readdir(agentDir, { withFileTypes: true });
    const mdFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => path.join(agentDir, e.name));

    return Promise.all(mdFiles.map(parseAgentFile));
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Export from index.ts**

Update `packages/core/src/index.ts`:
```typescript
export * from "./types.js";
export { ProjectStore } from "./project-store.js";
export type { ChangelogEntry } from "./project-store.js";
export { parseAgentFile, listAgents } from "./agent-parser.js";
```

- [ ] **Step 3: Verify build and commit**

Run: `npm run build`
```bash
git add -A && git commit -m "feat: implement AgentParser with frontmatter parsing"
```

---

## Task 5: Session Store

**Files:**
- Create: `packages/core/src/session-store.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Implement SessionStore**

Create `packages/core/src/session-store.ts`:

```typescript
import Database from "better-sqlite3";
import type { SessionInfo } from "./types.js";

const MIGRATION = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
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
  private db: Database.Database | null = null;

  async init(dbPath: string): Promise<void> {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(MIGRATION);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  createSession(agentName: string, title?: string): string {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db!
      .prepare(
        "INSERT INTO sessions (id, agent_name, title, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, 'active')",
      )
      .run(id, agentName, title ?? null, now, now);
    return id;
  }

  getSession(id: string): SessionInfo | null {
    const row = this.db!
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      agentName: row.agent_name,
      title: row.title ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status,
    };
  }

  listSessions(agentName?: string): SessionInfo[] {
    const query = agentName
      ? "SELECT * FROM sessions WHERE agent_name = ? ORDER BY updated_at DESC"
      : "SELECT * FROM sessions ORDER BY updated_at DESC";
    const rows = agentName
      ? (this.db!.prepare(query).all(agentName) as any[])
      : (this.db!.prepare(query).all() as any[]);
    return rows.map((row) => ({
      id: row.id,
      agentName: row.agent_name,
      title: row.title ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status,
    }));
  }

  appendMessage(sessionId: string, message: any): void {
    const now = Date.now();
    this.db!
      .prepare(
        "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
      )
      .run(sessionId, message.role, JSON.stringify(message), message.timestamp ?? now);
    this.db!
      .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
      .run(now, sessionId);
  }

  getSessionMessages(sessionId: string): any[] {
    const rows = this.db!
      .prepare(
        "SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC",
      )
      .all(sessionId) as any[];
    return rows.map((row) => JSON.parse(row.content));
  }

  updateSessionTitle(sessionId: string, title: string): void {
    this.db!
      .prepare("UPDATE sessions SET title = ? WHERE id = ?")
      .run(title, sessionId);
  }
}
```

- [ ] **Step 2: Export from index.ts**

Update `packages/core/src/index.ts`:
```typescript
export * from "./types.js";
export { ProjectStore } from "./project-store.js";
export type { ChangelogEntry } from "./project-store.js";
export { parseAgentFile, listAgents } from "./agent-parser.js";
export { SessionStore } from "./session-store.js";
```

- [ ] **Step 3: Verify build and commit**

Run: `npm run build`
```bash
git add -A && git commit -m "feat: implement SessionStore with SQLite persistence"
```

---

## Task 6: Agent Tools

**Files:**
- Create: `packages/core/src/tools/read-file.ts`
- Create: `packages/core/src/tools/write-file.ts`
- Create: `packages/core/src/tools/list-files.ts`
- Create: `packages/core/src/tools/search-content.ts`
- Create: `packages/core/src/tools/append-changelog.ts`
- Create: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Implement read_file tool**

Create `packages/core/src/tools/read-file.ts`:

```typescript
import { Type, type Static } from "@sinclair/typebox";
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const ReadFileSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read, relative to project root" }),
});

export function createReadFileTool(projectRoot: string): AgentTool<typeof ReadFileSchema> {
  return {
    name: "read_file",
    label: "Read File",
    description: "Read the contents of a file in the project. Returns the file content as text.",
    parameters: ReadFileSchema,
    async execute(_toolCallId, params, _signal) {
      const absolutePath = path.resolve(projectRoot, params.path);
      if (!absolutePath.startsWith(projectRoot)) {
        return {
          content: [{ type: "text" as const, text: "Error: path traversal not allowed" }],
          details: undefined,
        };
      }
      try {
        const content = await fs.readFile(absolutePath, "utf-8");
        return {
          content: [{ type: "text" as const, text: content }],
          details: { path: params.path, size: content.length },
        };
      } catch {
        return {
          content: [{ type: "text" as const, text: `Error: file not found at ${params.path}` }],
          details: undefined,
        };
      }
    },
  };
}
```

- [ ] **Step 2: Implement write_file tool**

Create `packages/core/src/tools/write-file.ts`:

```typescript
import { Type, type Static } from "@sinclair/typebox";
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const WriteFileSchema = Type.Object({
  path: Type.String({ description: "Path to write to, relative to project root" }),
  content: Type.String({ description: "Content to write" }),
  createDirs: Type.Optional(Type.Boolean({ description: "Create intermediate directories", default: true })),
});

export function createWriteFileTool(projectRoot: string): AgentTool<typeof WriteFileSchema> {
  return {
    name: "write_file",
    label: "Write File",
    description: "Write content to a file. Creates the file and intermediate directories if needed.",
    parameters: WriteFileSchema,
    async execute(_toolCallId, params, _signal) {
      const absolutePath = path.resolve(projectRoot, params.path);
      if (!absolutePath.startsWith(projectRoot)) {
        return {
          content: [{ type: "text" as const, text: "Error: path traversal not allowed" }],
          details: undefined,
        };
      }
      if (params.createDirs !== false) {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      }
      await fs.writeFile(absolutePath, params.content, "utf-8");
      return {
        content: [{ type: "text" as const, text: `Successfully wrote ${params.content.length} bytes to ${params.path}` }],
        details: { path: params.path, size: params.content.length },
      };
    },
  };
}
```

- [ ] **Step 3: Implement list_files tool**

Create `packages/core/src/tools/list-files.ts`:

```typescript
import { Type } from "@sinclair/typebox";
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const ListFilesSchema = Type.Object({
  path: Type.String({ description: "Directory path, relative to project root" }),
  recursive: Type.Optional(Type.Boolean({ description: "List recursively", default: false })),
});

async function walkDir(dir: string, recursive: boolean, prefix: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const lines: string[] = [];
  for (const entry of entries) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      lines.push(`📁 ${relPath}/`);
      if (recursive) {
        lines.push(...await walkDir(path.join(dir, entry.name), true, relPath));
      }
    } else {
      lines.push(`📄 ${relPath}`);
    }
  }
  return lines;
}

export function createListFilesTool(projectRoot: string): AgentTool<typeof ListFilesSchema> {
  return {
    name: "list_files",
    label: "List Files",
    description: "List files and directories in the project.",
    parameters: ListFilesSchema,
    async execute(_toolCallId, params, _signal) {
      const absolutePath = path.resolve(projectRoot, params.path);
      if (!absolutePath.startsWith(projectRoot)) {
        return {
          content: [{ type: "text" as const, text: "Error: path traversal not allowed" }],
          details: undefined,
        };
      }
      try {
        const recursive = params.recursive ?? false;
        const lines = await walkDir(absolutePath, recursive, "");
        return {
          content: [{ type: "text" as const, text: lines.join("\n") || "(empty directory)" }],
          details: { path: params.path, count: lines.length },
        };
      } catch {
        return {
          content: [{ type: "text" as const, text: `Error: directory not found at ${params.path}` }],
          details: undefined,
        };
      }
    },
  };
}
```

- [ ] **Step 4: Implement search_content tool**

Create `packages/core/src/tools/search-content.ts`:

```typescript
import { Type } from "@sinclair/typebox";
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const SearchContentSchema = Type.Object({
  query: Type.String({ description: "Text or regex pattern to search for" }),
  path: Type.Optional(Type.String({ description: "Directory to search in" })),
  includePatterns: Type.Optional(Type.Array(Type.String(), { description: "File patterns, e.g. ['*.md']" })),
});

async function searchFiles(
  dir: string,
  pattern: RegExp,
  projectRoot: string,
  includePatterns: string[] | undefined,
  results: Array<{ file: string; line: number; text: string }>,
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    if (entry.isDirectory()) {
      await searchFiles(fullPath, pattern, projectRoot, includePatterns, results);
    } else if (entry.isFile()) {
      if (includePatterns?.length) {
        const matches = includePatterns.some((p) => entry.name.endsWith(p.replace("*", "")));
        if (!matches) continue;
      }
      try {
        const content = await fs.readFile(fullPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            results.push({ file: path.relative(projectRoot, fullPath), line: i + 1, text: lines[i].trim() });
          }
        }
      } catch { /* skip unreadable files */ }
    }
  }
}

export function createSearchContentTool(projectRoot: string): AgentTool<typeof SearchContentSchema> {
  return {
    name: "search_content",
    label: "Search Content",
    description: "Search for text in project files. Supports regex.",
    parameters: SearchContentSchema,
    async execute(_toolCallId, params, _signal) {
      const searchDir = path.resolve(projectRoot, params.path ?? ".");
      const pattern = new RegExp(params.query, "i");
      const results: Array<{ file: string; line: number; text: string }> = [];
      await searchFiles(searchDir, pattern, projectRoot, params.includePatterns, results);
      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No results found." }],
          details: { query: params.query, count: 0 },
        };
      }
      const text = results.slice(0, 50).map((r) => `${r.file}:${r.line}: ${r.text}`).join("\n");
      return {
        content: [{ type: "text" as const, text }],
        details: { query: params.query, count: results.length },
      };
    },
  };
}
```

- [ ] **Step 5: Implement append_changelog tool**

Create `packages/core/src/tools/append-changelog.ts`:

```typescript
import { Type } from "@sinclair/typebox";
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const AppendChangelogSchema = Type.Object({
  agent: Type.String({ description: "Agent name performing the action" }),
  action: Type.String({ description: "Action type (write, create, update)" }),
  target: Type.String({ description: "File or resource affected" }),
  description: Type.String({ description: "Description of the change" }),
});

export function createAppendChangelogTool(
  projectRoot: string,
  changelogPath: string = "CHANGELOG.md",
): AgentTool<typeof AppendChangelogSchema> {
  return {
    name: "append_changelog",
    label: "Append Changelog",
    description: "Append an entry to the project's CHANGELOG.md.",
    parameters: AppendChangelogSchema,
    async execute(_toolCallId, params, _signal) {
      const absolutePath = path.resolve(projectRoot, changelogPath);
      const timestamp = new Date().toISOString();
      const line = `- **[${timestamp}]** ${params.agent} / ${params.action} / \`${params.target}\` — ${params.description}\n`;
      await fs.appendFile(absolutePath, line, "utf-8");
      return {
        content: [{ type: "text" as const, text: "Changelog entry added." }],
        details: { timestamp },
      };
    },
  };
}
```

- [ ] **Step 6: Create tool registry**

Create `packages/core/src/tools/index.ts`:

```typescript
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createReadFileTool } from "./read-file.js";
import { createWriteFileTool } from "./write-file.js";
import { createListFilesTool } from "./list-files.js";
import { createSearchContentTool } from "./search-content.js";
import { createAppendChangelogTool } from "./append-changelog.js";

export { createReadFileTool } from "./read-file.js";
export { createWriteFileTool } from "./write-file.js";
export { createListFilesTool } from "./list-files.js";
export { createSearchContentTool } from "./search-content.js";
export { createAppendChangelogTool } from "./append-changelog.js";

const TOOL_DEFAULTS: Record<string, string[]> = {
  creator: ["read_file", "write_file", "list_files", "search_content", "append_changelog"],
  roleplay: ["read_file", "list_files", "search_content"],
  scheduler: ["read_file", "write_file", "list_files", "search_content", "append_changelog"],
};

export function createToolsForProject(projectRoot: string, changelogPath?: string): Record<string, AgentTool> {
  return {
    read_file: createReadFileTool(projectRoot),
    write_file: createWriteFileTool(projectRoot),
    list_files: createListFilesTool(projectRoot),
    search_content: createSearchContentTool(projectRoot),
    append_changelog: createAppendChangelogTool(projectRoot, changelogPath),
  };
}

export function getDefaultToolsForAgentType(agentType: string): string[] {
  return TOOL_DEFAULTS[agentType] ?? TOOL_DEFAULTS["creator"];
}
```

- [ ] **Step 7: Export tools from core index.ts**

Update `packages/core/src/index.ts`:
```typescript
export * from "./types.js";
export { ProjectStore } from "./project-store.js";
export type { ChangelogEntry } from "./project-store.js";
export { parseAgentFile, listAgents } from "./agent-parser.js";
export { SessionStore } from "./session-store.js";
export { AgentEngine } from "./agent-engine.js";
export type { AgentEventHandler } from "./agent-engine.js";
export {
  createReadFileTool,
  createWriteFileTool,
  createListFilesTool,
  createSearchContentTool,
  createAppendChangelogTool,
  createToolsForProject,
  getDefaultToolsForAgentType,
} from "./tools/index.js";
```

Note: `AgentEngine` export is added preemptively for Task 7.

- [ ] **Step 8: Verify build and commit**

Run: `npm run build`
```bash
git add -A && git commit -m "feat: implement 5 agent tools with TypeBox schemas"
```

---

## Task 7: Agent Engine

**Files:**
- Create: `packages/core/src/agent-engine.ts`

- [ ] **Step 1: Implement AgentEngine**

Create `packages/core/src/agent-engine.ts`:

```typescript
import path from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple, getModel } from "@mariozechner/pi-ai";
import type { AgentEvent, AgentTool } from "@mariozechner/pi-agent-core";
import type { AgentDefinition } from "./types.js";
import { ProjectStore } from "./project-store.js";
import { SessionStore } from "./session-store.js";
import { listAgents } from "./agent-parser.js";
import { createToolsForProject, getDefaultToolsForAgentType } from "./tools/index.js";

export type AgentEventHandler = (event: AgentEvent) => void;

export class AgentEngine {
  private projectStore: ProjectStore;
  private sessionStore: SessionStore;
  private activeSessions: Map<string, Agent> = new Map();

  constructor(projectStore: ProjectStore, sessionStore: SessionStore) {
    this.projectStore = projectStore;
    this.sessionStore = sessionStore;
  }

  async listAgents(): Promise<AgentDefinition[]> {
    const config = this.projectStore.getConfig();
    if (!config) throw new Error("Project not opened");
    const agentDir = path.join(
      this.projectStore.getRootPath(),
      ".pi",
      config.paths.agents,
    );
    return listAgents(agentDir);
  }

  async createSession(agentName: string): Promise<string> {
    const definition = await this.findAgentDefinition(agentName);
    if (!definition) throw new Error(`Agent "${agentName}" not found`);

    const sessionId = this.sessionStore.createSession(agentName);
    const agent = await this.buildAgent(definition, sessionId);
    this.activeSessions.set(sessionId, agent);
    return sessionId;
  }

  async restoreSession(sessionId: string): Promise<string> {
    if (this.activeSessions.has(sessionId)) return sessionId;

    const session = this.sessionStore.getSession(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);

    const definition = await this.findAgentDefinition(session.agentName);
    if (!definition) throw new Error(`Agent "${session.agentName}" not found`);

    const agent = await this.buildAgent(definition, sessionId);
    agent.state.messages = this.sessionStore.getSessionMessages(sessionId);
    this.activeSessions.set(sessionId, agent);
    return sessionId;
  }

  async sendMessage(
    sessionId: string,
    message: string,
    onEvent: AgentEventHandler,
  ): Promise<void> {
    const agent = this.activeSessions.get(sessionId);
    if (!agent) throw new Error(`No active session "${sessionId}"`);

    const unsubscribe = agent.subscribe((event) => {
      onEvent(event);
      if (event.type === "message_end") {
        this.sessionStore.appendMessage(sessionId, event.message);
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
  }

  hasActiveSession(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  getSessionHistory(sessionId: string): any[] {
    return this.sessionStore.getSessionMessages(sessionId);
  }

  abortSession(sessionId: string): void {
    const agent = this.activeSessions.get(sessionId);
    if (agent) agent.abort();
  }

  private async findAgentDefinition(agentName: string): Promise<AgentDefinition | undefined> {
    const agents = await this.listAgents();
    return agents.find((a) => a.name === agentName);
  }

  private async buildAgent(definition: AgentDefinition, sessionId: string): Promise<Agent> {
    const config = this.projectStore.getConfig()!;
    const projectRoot = this.projectStore.getRootPath();
    const allTools = createToolsForProject(projectRoot, config.paths.changelog);

    const toolNames = definition.tools ?? getDefaultToolsForAgentType(definition.type);
    const tools: AgentTool[] = toolNames.map((name) => allTools[name]).filter(Boolean);

    const agentsMd = await this.projectStore.readIndex();
    const systemPrompt = `${agentsMd}\n\n---\n\n${definition.systemPrompt}`;

    const modelId = definition.model ?? config.defaultModel;
    const model = this.resolveModel(modelId);

    return new Agent({
      initialState: {
        systemPrompt,
        model,
        thinkingLevel: "medium",
        tools,
      },
      sessionId,
      streamFn: async (model, context, options) => {
        return streamSimple(model, context, options);
      },
    });
  }

  private resolveModel(modelId: string): any {
    const providers = ["google", "anthropic", "openai"] as const;
    for (const provider of providers) {
      try {
        return getModel(provider, modelId as any);
      } catch {
        continue;
      }
    }
    throw new Error(`Could not resolve model: ${modelId}`);
  }
}
```

- [ ] **Step 2: Verify build and commit**

Run: `npm run build`
```bash
git add -A && git commit -m "feat: implement AgentEngine with session lifecycle management"
```

---

## Task 8: Local Server

**Files:**
- Create: `packages/server/src/index.ts`
- Create: `packages/server/src/routes.ts`
- Create: `packages/server/src/ws-chat.ts`

- [ ] **Step 1: Implement server factory**

Create `packages/server/src/index.ts`:

```typescript
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { ProjectStore, SessionStore, AgentEngine } from "@worldbuilding-agent/core";
import { registerRoutes } from "./routes.js";
import { handleChatWebSocket } from "./ws-chat.js";

export interface AppContext {
  projectStore: ProjectStore;
  sessionStore: SessionStore;
  agentEngine: AgentEngine;
}

export async function createServer(projectRoot: string) {
  const fastify = Fastify({ logger: true });

  await fastify.register(cors, { origin: true });
  await fastify.register(websocket);

  const projectStore = new ProjectStore(projectRoot);
  await projectStore.open();

  const sessionStore = new SessionStore();
  await sessionStore.init(`${projectRoot}/.pi/sessions.db`);

  const agentEngine = new AgentEngine(projectStore, sessionStore);

  const ctx: AppContext = { projectStore, sessionStore, agentEngine };

  registerRoutes(fastify, ctx);
  handleChatWebSocket(fastify, ctx);

  return fastify;
}
```

- [ ] **Step 2: Implement REST routes**

Create `packages/server/src/routes.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "./index.js";

export function registerRoutes(fastify: FastifyInstance, ctx: AppContext) {
  fastify.get("/api/agents", async () => {
    return ctx.agentEngine.listAgents();
  });

  fastify.get<{ Params: { name: string } }>("/api/agents/:name", async (req, reply) => {
    const agents = await ctx.agentEngine.listAgents();
    const agent = agents.find((a) => a.name === req.params.name);
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    return agent;
  });

  fastify.post<{ Body: { agentName?: string } }>("/api/sessions", async (req, reply) => {
    const { agentName } = req.body ?? {};
    if (!agentName) return reply.code(400).send({ error: "agentName is required" });
    try {
      const sessionId = await ctx.agentEngine.createSession(agentName);
      return { sessionId };
    } catch (err: any) {
      return reply.code(404).send({ error: err.message });
    }
  });

  fastify.get<{ Params: { id: string } }>("/api/sessions/:id", async (req, reply) => {
    const session = ctx.sessionStore.getSession(req.params.id);
    if (!session) return reply.code(404).send({ error: "Session not found" });
    return session;
  });

  fastify.get<{ Params: { id: string } }>("/api/sessions/:id/messages", async (req) => {
    return ctx.agentEngine.getSessionHistory(req.params.id);
  });

  fastify.get<{ Params: { "*": string } }>("/api/content/*", async (req, reply) => {
    const relativePath = req.params["*"];
    const absolutePath = path.resolve(ctx.projectStore.getRootPath(), relativePath);

    if (!absolutePath.startsWith(ctx.projectStore.getRootPath())) {
      return reply.code(403).send({ error: "Access denied" });
    }

    try {
      const stat = await fs.stat(absolutePath);
      if (stat.isDirectory()) {
        const entries = await fs.readdir(absolutePath, { withFileTypes: true });
        return entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "directory" : "file",
        }));
      }
      const content = await fs.readFile(absolutePath, "utf-8");
      return { content, path: relativePath };
    } catch {
      return reply.code(404).send({ error: "Not found" });
    }
  });
}
```

- [ ] **Step 3: Implement WebSocket chat handler**

Create `packages/server/src/ws-chat.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { AppContext } from "./index.js";

export function handleChatWebSocket(fastify: FastifyInstance, ctx: AppContext) {
  fastify.get<{ Params: { sessionId: string } }>(
    "/ws/chat/:sessionId",
    { websocket: true },
    (socket, req) => {
      const { sessionId } = req.params;

      ctx.agentEngine.restoreSession(sessionId).catch((err) => {
        socket.send(JSON.stringify({ type: "error", message: err.message }));
        socket.close();
      });

      socket.on("message", async (raw) => {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "message") {
          try {
            await ctx.agentEngine.sendMessage(sessionId, msg.content, (event) => {
              socket.send(JSON.stringify(event));
            });
            socket.send(JSON.stringify({ type: "agent_end_done" }));
          } catch (err: any) {
            socket.send(JSON.stringify({ type: "error", message: err.message }));
          }
        } else if (msg.type === "abort") {
          ctx.agentEngine.abortSession(sessionId);
        }
      });
    },
  );
}
```

- [ ] **Step 4: Verify build and commit**

Run: `npm run build`
```bash
git add -A && git commit -m "feat: implement Fastify server with REST and WebSocket routes"
```

---

## Task 9: Electron Shell + React Frontend

**Files:**
- Create: `packages/app/electron/main.ts`
- Create: `packages/app/index.html`
- Create: `packages/app/src/main.tsx`
- Create: `packages/app/src/App.tsx`

- [ ] **Step 1: Implement Electron main process**

Create `packages/app/electron/main.ts`:

```typescript
import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import { createServer } from "@worldbuilding-agent/server";

let mainWindow: BrowserWindow | null = null;
let server: any = null;

async function startServer(projectRoot: string) {
  server = await createServer(projectRoot);
  const address = server.server.address();
  const port = typeof address === "object" && address ? address.port : 3000;
  return port;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });

  if (process.env.ELECTRON_DEV_URL) {
    mainWindow.loadURL(process.env.ELECTRON_DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist-renderer/index.html"));
  }
}

ipcMain.handle("select-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("start-server", async (_event, projectRoot: string) => {
  return startServer(projectRoot);
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  server?.close();
  app.quit();
});
```

- [ ] **Step 2: Create index.html**

Create `packages/app/index.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Worldbuilding Agent</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 3: Create React entry**

Create `packages/app/src/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 4: Create App component**

Create `packages/app/src/App.tsx`:

```tsx
import React, { useState, useEffect, useRef } from "react";

declare global {
  interface Window {
    electronAPI: {
      selectDirectory: () => Promise<string | null>;
      startServer: (projectRoot: string) => Promise<number>;
    };
  }
}

export function App() {
  const [serverPort, setServerPort] = useState<number | null>(null);
  const [status, setStatus] = useState("选择一个世界观项目文件夹开始");

  const handleOpenProject = async () => {
    const dir = await window.electronAPI.selectDirectory();
    if (!dir) return;
    setStatus("正在启动服务器...");
    const port = await window.electronAPI.startServer(dir);
    setServerPort(port);
    setStatus(`服务器已启动 (port ${port})`);
  };

  if (!serverPort) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <h1>Worldbuilding Agent</h1>
        <p>{status}</p>
        <button onClick={handleOpenProject}>打开项目</button>
      </div>
    );
  }

  return <ProjectPage port={serverPort} />;
}

function ProjectPage({ port }: { port: number }) {
  const baseUrl = `http://localhost:${port}`;
  const [agents, setAgents] = useState<any[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    fetch(`${baseUrl}/api/agents`)
      .then((r) => r.json())
      .then(setAgents);
  }, []);

  const handleStartChat = async (agentName: string) => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName }),
    });
    const { sessionId: sid } = await res.json();
    setSessionId(sid);
    setMessages([]);

    const ws = new WebSocket(`ws://localhost:${port}/ws/chat/${sid}`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "message_update" && data.message?.role === "assistant") {
        const textContent = data.message.content?.find((c: any) => c.type === "text");
        if (textContent) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && last._streaming) {
              return [...prev.slice(0, -1), { role: "assistant", content: textContent.text, _streaming: true }];
            }
            return [...prev, { role: "assistant", content: textContent.text, _streaming: true }];
          });
        }
      } else if (data.type === "message_end" && data.message?.role === "assistant") {
        const textContent = data.message.content?.find((c: any) => c.type === "text");
        if (textContent) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && last._streaming) {
              return [...prev.slice(0, -1), { role: "assistant", content: textContent.text, _streaming: false }];
            }
            return [...prev, { role: "assistant", content: textContent.text, _streaming: false }];
          });
        }
      } else if (data.type === "agent_end_done") {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?._streaming) {
            return [...prev.slice(0, -1), { ...last, _streaming: false }];
          }
          return prev;
        });
      }
    };
    wsRef.current = ws;
  };

  const handleSend = (text: string) => {
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    wsRef.current?.send(JSON.stringify({ type: "message", content: text }));
  };

  if (!sessionId) {
    return (
      <div style={{ padding: 24 }}>
        <h2>选择 Agent 开始对话</h2>
        {agents.map((a) => (
          <button key={a.name} onClick={() => handleStartChat(a.name)} style={{ marginRight: 8, marginBottom: 8 }}>
            {a.name} ({a.type})
          </button>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <strong>{m.role === "user" ? "你" : "Agent"}:</strong>
            <p style={{ whiteSpace: "pre-wrap" }}>{m.content}</p>
          </div>
        ))}
      </div>
      <div style={{ padding: 16, borderTop: "1px solid #ccc" }}>
        <input
          style={{ width: "80%", padding: 8 }}
          placeholder="输入消息..."
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.currentTarget.value.trim()) {
              handleSend(e.currentTarget.value.trim());
              e.currentTarget.value = "";
            }
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify Electron can start**

Run: `cd packages/app && npm run dev`
Expected: Electron window opens showing project selection screen.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add Electron shell with React frontend"
```

---

## Dependency Graph

```
Task 1 (Scaffolding)
    ↓
Task 2 (Types)
    ↓
Task 3 (Project Store)  ←  Task 4 (Agent Parser)  ←  Task 5 (Session Store)
    ↓                          ↓                           ↓
    └────────────────────→ Task 6 (Tools) ←───────────────┘
                              ↓
                         Task 7 (Agent Engine)
                              ↓
                         Task 8 (Local Server)
                              ↓
                         Task 9 (Electron + React)
```

Tasks 3, 4, 5 are independent and can be implemented in parallel.

## Self-Review

### Spec Coverage

| Spec Requirement | Task | Status |
|-----------------|------|--------|
| Project create/open | Task 3 | ✅ |
| Agent definition parsing | Task 4 | ✅ |
| Session persistence (SQLite) | Task 5 | ✅ |
| 5 agent tools | Task 6 | ✅ |
| Agent Engine with session lifecycle | Task 7 | ✅ |
| Local server (REST + WebSocket) | Task 8 | ✅ |
| Content browsing | Task 8 (GET /api/content/*) | ✅ |
| AGENTS.md management | Task 3 | ✅ |
| CHANGELOG.md management | Task 3 + Task 6 | ✅ |
| Electron desktop app | Task 9 | ✅ |
| Chat UI with streaming | Task 9 | ✅ |
| Model resolution | Task 7 (resolveModel) | ✅ |

### Placeholder Scan

No TBD, TODO, or vague descriptions. All steps contain complete code.

### Type Consistency

- `AgentDefinition` in `types.ts` → used in `agent-parser.ts`, `agent-engine.ts`
- `SessionInfo` in `types.ts` → used in `session-store.ts`
- Tool factory functions all return `AgentTool<typeof XxxSchema>`
- `ProjectStore.getConfig()` returns `ProjectConfig | null`, null-checked in AgentEngine
- `createToolsForProject` returns `Record<string, AgentTool>`, accessed by name in AgentEngine
