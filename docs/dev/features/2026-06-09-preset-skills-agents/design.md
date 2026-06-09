# 项目初始化时自动添加预设 Skill 和 Agent

## 目标

项目首次创建时，自动从 `@spherse/presets` 加载预设 skill 和 agent，使用户开箱即用。开发侧通过配置文件声明预设内容，便于后续扩展。

## 动机

当前新项目创建后 `.spherse/skills/` 为空，用户需要手动创建 skill；也没有默认 agent。`@spherse/presets` 中已有 `skills/create-ui-theme/` 和 `skills/create-agent-chat-theme/` 两个 skill 源文件，但未被复制到用户项目。本 feature 将预设内容在项目初始化时自动注入。

## 需求

- 项目首次创建时，自动将预设 skill 复制到 `.spherse/skills/`
- 项目首次创建时，自动创建预设 agent（名为「世界观创作」）
- 开发侧通过配置文件声明哪些 skill 和 agent 是预设的
- 预设内容复制到项目后属于用户所有，用户可自由修改/删除，app 升级不覆盖
- 仅在首次创建时注入，已有项目不受影响

## 设计

### 1. `@spherse/presets` 新增 `presets.json` 配置文件

在 `packages/presets/presets.json` 中声明预设列表：

```json
{
  "presetSkills": [
    { "dir": "create-ui-theme" },
    { "dir": "create-agent-chat-theme" }
  ],
  "presetAgents": [
    { "name": "世界观创作", "slug": "world-building" }
  ]
}
```

使用 JSON 而非 YAML，避免在 sync-templates.mjs（Node.js 直接运行的 .mjs 脚本）中引入 yaml 解析依赖。

- `presetSkills[].dir` 对应 `packages/presets/skills/{dir}/` 目录，整个目录（含所有文件和子目录）复制到用户项目的 `.spherse/skills/{dir}/`
- `presetAgents[].name` 和 `slug` 用于通过 `AgentProfileStore.save()` 创建 agent
- 预设 agent 的 profile 内容基于现有 `AGENT_TEMPLATE`，仅将 `name` 字段替换为配置中的 `name`，其余保持模板默认值

### 2. `sync-templates.mjs` 扩展

在现有 `prebuild` 脚本中新增生成步骤：

1. 解析 `presets.json`
2. 递归扫描声明的 skill 目录下所有文件
3. 生成 `src/generated/presets.ts`：

```typescript
export const PRESET_SKILLS = [
  { dir: "create-ui-theme" },
  { dir: "create-agent-chat-theme" },
];

export const PRESET_AGENTS = [
  { name: "世界观创作", slug: "world-building" },
];
```

4. 生成 `src/generated/preset-skills.ts`：

```typescript
export const PRESET_SKILL_SOURCES: { dir: string; files: { relativePath: string; content: string }[] }[] = [
  {
    dir: "create-ui-theme",
    files: [
      { relativePath: "SKILL.md", content: "..." },
      // 其他文件...
    ],
  },
  // ...
];
```

5. 校验：如果 `presets.json` 中声明的 `dir` 在 `skills/` 下不存在，构建时报错退出

### 3. `@spherse/presets` 导出扩展

```typescript
export { PRESET_SKILLS, PRESET_AGENTS } from "./generated/presets.js";
export { PRESET_SKILL_SOURCES } from "./generated/preset-skills.js";
export { AGENT_TEMPLATE } from "./generated/agent-template.js";
export { AGENT_THEME_TEMPLATE } from "./generated/agent-theme-template.js";
```

### 4. core 层注入逻辑

新增 `packages/core/src/presets.ts`，导出 `initPresets()`：

```typescript
import { PRESET_SKILL_SOURCES, PRESET_AGENTS, AGENT_TEMPLATE } from "@spherse/presets";
import type { AgentProfileStore } from "./store/agent-profile.js";
import fs from "node:fs/promises";
import path from "node:path";

export async function initPresets(
  projectRoot: string,
  spherseDir: string,
  profileStore: AgentProfileStore,
): Promise<void> {
  // 1. 复制预设 skill
  for (const skill of PRESET_SKILL_SOURCES) {
    const skillDir = path.join(spherseDir, "skills", skill.dir);
    await fs.mkdir(skillDir, { recursive: true });
    for (const file of skill.files) {
      const filePath = path.join(skillDir, file.relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.content, "utf-8");
    }
  }

  // 2. 创建预设 agent
  for (const agent of PRESET_AGENTS) {
    const content = AGENT_TEMPLATE.replace("name: 新 Agent", `name: ${agent.name}`);
    await profileStore.save(agent.slug, content);
  }
}
```

### 5. 调用时机

在 `packages/core/src/factory.ts` 的 `createEngine()` 中：

```typescript
let isNewProject = false;
try {
  await projectStore.open();
} catch {
  const dirName = path.basename(path.resolve(projectRoot));
  await projectStore.create(
    options?.projectName ?? dirName,
    options?.defaultModel ?? "gemini-2.5-pro",
  );
  isNewProject = true;
}

const config = projectStore.getConfig()!;
const profileStore = new AgentProfileStore(...);
const skillStore = new SkillStore(...);
const sessionStore = new SessionStore(...);

if (isNewProject) {
  await initPresets(projectRoot, spherseDir, profileStore);
}
```

### 6. 错误处理

- `initPresets()` 中每个 skill 和 agent 条目独立 try/catch，单个失败 log warning 不阻塞其余条目和项目初始化
- `sync-templates.mjs` 中声明的 skill dir 不存在时构建报错退出，将问题拦截在开发期

### 7. 目录结构变更

```
packages/presets/
├── presets.json                  # 新增
├── scripts/
│   └── sync-templates.mjs        # 扩展：新增 presets.json 和 skill 目录的生成逻辑
├── skills/                       # 不变
│   ├── create-ui-theme/
│   └── create-agent-chat-theme/
├── templates/                    # 不变
│   ├── agent-template.md
│   └── agent-theme-template.css
└── src/
    ├── index.ts                  # 扩展导出
    └── generated/
        ├── presets.ts            # 新增
        └── preset-skills.ts      # 新增

packages/core/
└── src/
    ├── presets.ts                # 新增：initPresets()
    └── factory.ts                # 修改：新增项目时调用 initPresets()
```

## 测试策略

- `packages/presets`：单元测试验证 `sync-templates.mjs` 生成结果——`PRESET_SKILLS`、`PRESET_AGENTS`、`PRESET_SKILL_SOURCES` 结构正确，skill 文件内容完整
- `packages/core`：单元测试验证 `initPresets()`——在新项目临时目录中调用后，验证 `.spherse/skills/` 下存在预期的 skill 文件（含子目录），agent 列表包含预设 agent 且 name/slug 正确
- 不新增 API 端点，不需要 server/app 层测试

## 修改范围

- 新增：`packages/presets/presets.json`
- 修改：`packages/presets/scripts/sync-templates.mjs`
- 修改：`packages/presets/src/index.ts`
- 新增：`packages/core/src/presets.ts`
- 修改：`packages/core/src/factory.ts`
- 新增：`packages/core/src/__tests__/presets.test.ts`
- 修改：`packages/core/package.json` — 添加 `@spherse/presets` 依赖
