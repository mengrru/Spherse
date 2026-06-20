# 实施计划：将内置 skill 变成真内置

- **Design**: `docs/dev/features/2026-06-20-builtin-skills/design.md`
- **Mode**: subagent-driven

## 任务依赖图

```
T1 (presets.json) ─┐
                   ├─→ T3 (SkillStore) ─→ T4 (ProjectStore + initPresets) ─┐
T2 (types) ────────┘                                                     │
                                                                        ├─→ T7 (verify)
T5 (server contract) ─── (独立) ────────────────────────────────────────┤
T6 (docs) ───────────── (独立) ─────────────────────────────────────────┘
```

- **可并行启动**：T1、T2、T5、T6（无相互依赖）
- **T3** 依赖 T1（需要新 `PRESET_SKILL_SOURCES` 含 use-ui-sdk）、T2（需要 `source` 字段类型）
- **T4** 依赖 T3（需要重构后的 SkillStore 构造签名）
- **T5（server contract）、T6（docs）完全独立**，仅依赖最终的 T7 验证
- **T7** 最后执行

## T1 — presets 包：启用 use-ui-sdk（独立，先行）

**文件**：
- `packages/presets/presets.json`：`presetSkills` 数组追加 `{ "dir": "use-ui-sdk" }`
- 触发 `npm run build --workspace=packages/presets` 重新生成 `src/generated/preset-skills.ts`

**验收**：
- `PRESET_SKILL_SOURCES` 导出含三个 skill（create-ui-theme、create-agent-chat-theme、use-ui-sdk）
- 验证命令：`npm run build --workspace=packages/presets` 通过

**注意**：T1 是后续 T3 的前置，应最先完成。

## T2 — core types：SkillDefinition 新增 source 字段（独立）

**文件**：`packages/core/src/types.ts`

```ts
export interface SkillDefinition {
  name: string;
  description: string;
  instructions: string;
  filePath: string;
  source: "builtin" | "project";  // 新增
}
```

**验收**：T2 是破坏性改动，单独执行后 `npm run build` **会失败**（多处构造 `SkillDefinition` 缺 `source` 字段）。T2 不应单独验收，必须与 T3、T4、T5 在同一轮内完成，最终以 T3/T4/T5 的验收命令为准。

## T3 — core SkillStore：双源合并重构（核心，依赖 T1+T2）

**文件**：`packages/core/src/store/skill.ts`

**改动**：
- 构造器：`constructor(skillDir: string)` → `constructor(skillDir: string, builtinSources?: readonly PresetSkillSource[])`
  - `PresetSkillSource` 类型在 core 本地定义：`type PresetSkillSource = { dir: string; files: { relativePath: string; content: string }[] }`（@spherse/presets 仅导出 `PRESET_SKILL_SOURCES` 常量值，未导出命名类型；本地定义保证 SkillStore 解耦不硬依赖 presets 的内部结构）
- 新增 `private async parseBuiltin(sources): Promise<SkillDefinition[]>`：
  - 遍历 builtinSources，找 `relativePath === "SKILL.md"` 的条目，用 `gray-matter` 解析
  - 返回 `{ ..., filePath: "builtin://<dir>/SKILL.md", source: "builtin" }`
- `parseSkill`（磁盘）返回的 `SkillDefinition` 补 `source: "project"`
- `list()`：合并 builtin + project，**同 name 时 project 覆盖 builtin**（先入 builtin 建 Map，再用 project 覆盖）
- `get(name)`：先查 project，无则查 builtin

**测试**（`packages/core/src/__tests__/store/skill.test.ts`，先写后改）：
- 纯 builtin（传 builtinSources、skillDir 不存在）
- 纯 project（不传 builtinSources，保持向后兼容）
- 合并 + project 覆盖 builtin（同 name）
- 空场景
- `get(name)` 返回 project-local 优先
- 既有测试补 `source` 字段断言

**验收**：`npm test --workspace=packages/core -- skill.test` 通过。

## T4 — core：ProjectStore 注入 + initPresets 瘦身（依赖 T3）

**文件**：
- `packages/core/src/store/project.ts`：
  - `new SkillStore(path.join(this.spherseDir, "skills"))` → `new SkillStore(path.join(this.spherseDir, "skills"), PRESET_SKILL_SOURCES)`
  - 两处（`open()` 和 `create()`）都改，line 58、line 77
  - import `PRESET_SKILL_SOURCES` from `@spherse/presets`
- `packages/core/src/presets.ts`：
  - 删除 skill 文件拷贝块（原 line 12–24 的 for 循环）
  - 改为 `await fs.mkdir(path.join(spherseDir, "skills"), { recursive: true });`（保留空目录创建）
  - 保留 preset agent 创建逻辑

**测试**：
- `packages/core/src/__tests__/presets.test.ts`：
  - 删除/改写 `it("copies all preset skills...")` → 改为 `it("creates .spherse/skills/ directory but does not copy skills")`：断言目录存在且为空
  - 保留 preset agent 创建测试
  - 保留 "does not throw" 测试

**验收**：`npm test --workspace=packages/core` 通过。

## T5 — server contract：新增 source 字段（独立）

**文件**：`packages/server/src/contracts/skills.ts`

```ts
source: Type.Union([Type.Literal("builtin"), Type.Literal("project")])
```

加到 `skillDefinition` schema（required）。

**验收**：`npm run build --workspace=packages/server` 通过；`npm test --workspace=packages/server` 通过。

## T6 — 文档同步（独立，可并行）

**文件**：
- `docs/official/architecture.md`（line 25 Skill 系统、line 29 预置内容注入）：改为「builtin skill 通过 SkillStore 内存合并，不再注入到 .spherse/skills/；用户仍可在 .spherse/skills/ 自建 project-local skill」
- `docs/official/data-conventions.md`（122–140、158–195）：
  - `SkillDefinition` 补 `source` 字段说明
  - `.spherse/skills/` 改为「用户自建 skill 目录（可选）」
  - 移除「preset skill 注入」「注入后内容属用户所有，app 升级不会覆盖」描述
- `docs/official/project-structure.md`（line 50）：注释改为「内置 skill 源（app 内置，通过 SkillStore 内存合并）」
- `docs/dev/backlog.md`：新增 `[x] **内置 skill 真内置化**：将 preset skill 从 per-project 注入改为 app 内置只读`

**验收**：人工检查文档描述与改动后的代码一致。

## T7 — 全量验证（最后）

**命令**：
```bash
npm run build
npm run lint
npm test --workspace=packages/core
npm test --workspace=packages/server
npm run verify
```

**验收**：全部通过，无类型错误、无 lint 错误、无测试失败。

## 实施顺序建议

1. **T1** 先行（presets 重新生成，其他任务依赖新常量）
2. **T2 + T5 + T6** 并行（types / server contract / docs 互不依赖）
3. **T3**（SkillStore 核心重构，依赖 T1+T2）
4. **T4**（ProjectStore + initPresets，依赖 T3）
5. **T7** 全量验证

## 风险点

- **SkillStore 向后兼容**：T3 必须保证 `builtinSources` 可选，未传时行为与现状完全一致（T4 之外的旧调用方不受影响）
- **types.ts 改动会触发多处类型报错**：T2 是「破坏性」改动，T3/T4/T5 需在同一轮内补齐，否则中间状态编译不过——subagent 调度时 T2→T3→T4→T5 应连续执行
