# Skill 支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add runtime skill discovery and loading, allowing agents to autonomously load reusable prompt instructions from `.spherse/skills/*/SKILL.md`.

**Architecture:** A new `SkillStore` reads skill definitions from the filesystem. During agent construction, all skill names and descriptions are injected into the system prompt as a catalog. A `load_skill` tool lets the LLM load a skill's full instructions on demand. Server routes expose skill metadata to the frontend.

**Tech Stack:** TypeScript (ESM, strict), gray-matter (YAML frontmatter), @sinclair/typebox (tool schemas), @mariozechner/pi-agent-core (AgentTool)

---

### Task 1: Add SkillDefinition type

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: Add SkillDefinition interface to types.ts**

Append after `AgentProfile` interface:

```typescript
export interface SkillDefinition {
  name: string;
  description: string;
  instructions: string;
  filePath: string;
}
```

- [ ] **Step 2: Build to verify**

Run: `npm run build --workspace=packages/core`
Expected: compiles without error

---

### Task 2: Create SkillStore

**Files:**
- Create: `packages/core/src/store/skill.ts`

- [ ] **Step 1: Create store/skill.ts**

Follow the pattern of `AgentProfileStore` but simpler — read-only, no save/delete:

```typescript
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { SkillDefinition } from "../types.js";

export class SkillStore {
  private skillDir: string;

  constructor(skillDir: string) {
    this.skillDir = skillDir;
  }

  async list(): Promise<SkillDefinition[]> {
    if (!fsSync.existsSync(this.skillDir)) return [];

    try {
      const entries = await fs.readdir(this.skillDir, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory());

      const skills = await Promise.all(
        dirs.map((d) => this.parseSkill(d.name)),
      );
      return skills.filter((s): s is SkillDefinition => s !== null);
    } catch {
      return [];
    }
  }

  async get(name: string): Promise<SkillDefinition | null> {
    return this.parseSkill(name);
  }

  private async parseSkill(dirName: string): Promise<SkillDefinition | null> {
    const skillMdPath = path.join(this.skillDir, dirName, "SKILL.md");
    try {
      const raw = await fs.readFile(skillMdPath, "utf-8");
      const { data, content } = matter(raw);

      if (!data.name || !data.description) return null;

      return {
        name: data.name,
        description: data.description,
        instructions: content.trim(),
        filePath: skillMdPath,
      };
    } catch {
      return null;
    }
  }
}
```

---

### Task 3: Export SkillStore from store/index.ts

**Files:**
- Modify: `packages/core/src/store/index.ts`

- [ ] **Step 1: Add SkillStore export**

Append to `packages/core/src/store/index.ts`:

```typescript
export { SkillStore } from "./skill.js";
```

- [ ] **Step 2: Build to verify**

Run: `npm run build --workspace=packages/core`
Expected: compiles without error

---

### Task 4: Create load_skill tool

**Files:**
- Create: `packages/core/src/tools/load-skill.ts`

- [ ] **Step 1: Create tools/load-skill.ts**

Follow the pattern of `createReadFileTool`:

```typescript
import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { SkillStore } from "../store/skill.js";

const LoadSkillParams = Type.Object({
  skill_name: Type.String({ description: "Name of the skill to load" }),
});

export function createLoadSkillTool(skillDir: string): AgentTool<typeof LoadSkillParams> {
  const store = new SkillStore(skillDir);

  return {
    name: "load_skill",
    label: "Load Skill",
    description:
      "Load a skill's full instructions. Use this when you want to activate a skill from the available skills list.",
    parameters: LoadSkillParams,
    async execute(_toolCallId, params, _signal) {
      const skill = await store.get(params.skill_name);
      if (!skill) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: skill "${params.skill_name}" not found.`,
            },
          ],
          details: undefined,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `# Skill: ${skill.name}\n\n${skill.instructions}`,
          },
        ],
        details: { name: skill.name },
      };
    },
  };
}
```

---

### Task 5: Register load_skill in tools/index.ts

**Files:**
- Modify: `packages/core/src/tools/index.ts`

- [ ] **Step 1: Add import and export for load_skill**

Add import:

```typescript
import { createLoadSkillTool } from "./load-skill.js";
```

Add export:

```typescript
export { createLoadSkillTool } from "./load-skill.js";
```

- [ ] **Step 2: Add skillDir parameter and load_skill to createToolsForProject**

Change the function signature and body:

```typescript
export function createToolsForProject(
  projectRoot: string,
  changelogPath?: string,
  skillDir?: string,
): Record<string, AgentTool<any>> {
  const tools: Record<string, AgentTool<any>> = {
    read_file: createReadFileTool(projectRoot),
    write_file: createWriteFileTool(projectRoot),
    edit_file: createEditFileTool(projectRoot),
    list_files: createListFilesTool(projectRoot),
    search_content: createSearchContentTool(projectRoot),
    append_changelog: createAppendChangelogTool(projectRoot, changelogPath),
  };

  if (skillDir) {
    tools.load_skill = createLoadSkillTool(skillDir);
  }

  return tools;
}
```

- [ ] **Step 3: Build to verify**

Run: `npm run build --workspace=packages/core`
Expected: compiles without error

---

### Task 6: Wire SkillStore into Engine

**Files:**
- Modify: `packages/core/src/engine.ts`

- [ ] **Step 1: Add skillStore field and constructor parameter**

Add import:

```typescript
import { SkillStore } from "./store/skill.js";
```

Add field and update constructor:

```typescript
private skillStore: SkillStore;

constructor(
  profileStore: AgentProfileStore,
  sessionStore: SessionStore,
  projectStore: ProjectStore,
  skillStore: SkillStore,
  options?: { defaultModel?: string },
) {
  this.profileStore = profileStore;
  this.sessionStore = sessionStore;
  this.projectStore = projectStore;
  this.skillStore = skillStore;
  this.globalDefaultModel = options?.defaultModel;
}
```

- [ ] **Step 2: Add listSkills and getSkill methods**

```typescript
async listSkills(): Promise<SkillDefinition[]> {
  return this.skillStore.list();
}

async getSkill(name: string): Promise<SkillDefinition | null> {
  return this.skillStore.get(name);
}
```

Remember to add `SkillDefinition` to the import from `./types.js`.

- [ ] **Step 3: Inject skill catalog into system prompt in buildAgent()**

After the existing `systemPrompt` line, add skill catalog injection. Replace:

```typescript
const agentsMd = await this.projectStore.readIndex();
const systemPrompt = `${agentsMd}\n\n---\n\n${profile.systemPrompt}`;
```

With:

```typescript
const agentsMd = await this.projectStore.readIndex();
let systemPrompt = `${agentsMd}\n\n---\n\n${profile.systemPrompt}`;

const skills = await this.skillStore.list();
if (skills.length > 0) {
  const skillCatalog = skills
    .map((s) => `- **${s.name}**: ${s.description}`)
    .join("\n");
  systemPrompt += `\n\n## Available Skills\n\n${skillCatalog}\n\nUse the load_skill tool to load a skill's full instructions when needed.`;
}
```

- [ ] **Step 4: Pass skillDir to createToolsForProject**

In `buildAgent()`, update the `createToolsForProject` call:

```typescript
const skillDir = path.join(projectRoot, ".spherse", "skills");
const allTools = createToolsForProject(
  projectRoot,
  config.paths.changelog,
  skillDir,
);
```

`path` is already imported.

- [ ] **Step 5: Build to verify**

Run: `npm run build --workspace=packages/core`
Expected: compiles without error

---

### Task 7: Update factory.ts to create SkillStore

**Files:**
- Modify: `packages/core/src/factory.ts`

- [ ] **Step 1: Import SkillStore and pass to Engine**

Add import:

```typescript
import { SkillStore } from "./store/skill.js";
```

Create SkillStore and pass to Engine constructor. After the `AgentProfileStore` creation, add:

```typescript
const skillStore = new SkillStore(path.join(projectRoot, ".spherse", "skills"));
```

Update Engine construction:

```typescript
const engine = new Engine(profileStore, sessionStore, projectStore, skillStore, {
  defaultModel: options?.defaultModel,
});
```

- [ ] **Step 2: Build to verify**

Run: `npm run build --workspace=packages/core`
Expected: compiles without error

---

### Task 8: Update core index.ts exports

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add SkillStore export**

Add:

```typescript
export { SkillStore } from "./store/skill.js";
```

- [ ] **Step 2: Build full project**

Run: `npm run build`
Expected: all packages compile without error

---

### Task 9: Create server skills route

**Files:**
- Create: `packages/server/src/routes/skills.ts`

- [ ] **Step 1: Create routes/skills.ts**

Follow the pattern of `routes/agents.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../index.js";

export function registerSkillRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  fastify.get("/api/skills", async () => {
    return ctx.engine.listSkills();
  });

  fastify.get<{ Params: { name: string } }>(
    "/api/skills/:name",
    async (req, reply) => {
      const skill = await ctx.engine.getSkill(req.params.name);
      if (!skill) return reply.code(404).send({ error: "Skill not found" });
      return skill;
    },
  );
}
```

---

### Task 10: Register skills route

**Files:**
- Modify: `packages/server/src/routes/index.ts`

- [ ] **Step 1: Add import and registration**

Add import:

```typescript
import { registerSkillRoutes } from "./skills.js";
```

Add to `registerAllRoutes`:

```typescript
registerSkillRoutes(fastify, ctx);
```

- [ ] **Step 2: Build full project**

Run: `npm run build`
Expected: all packages compile without error

---

### Task 11: Smoke test

- [ ] **Step 1: Create a test skill definition**

Create `.spherse/skills/test-skill/SKILL.md` in a test project directory:

```markdown
---
name: test-skill
description: A test skill for verification
---

This is a test skill instruction.
```

- [ ] **Step 2: Verify SkillStore reads it correctly**

Use Node REPL or a quick script to confirm `SkillStore.list()` returns the test skill.

- [ ] **Step 3: Verify API routes work**

Start the server and call `GET /api/skills` and `GET /api/skills/test-skill` to confirm correct responses.
