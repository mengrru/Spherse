# 将内置 skill 变成真内置

- **Date**: 2026-06-20
- **Status**: Design
- **Backlog**: 新增 `[x] 内置 skill 真内置化：将 preset skill 从 per-project 注入改为 app 内置只读`

## 1. 背景与动机

当前内置 skill 的实现方式是 **copy-on-create**：新项目首次打开时，`initPresets()` 把 `@spherse/presets` 中声明的 preset skill 文件拷贝到用户的 `.spherse/skills/` 目录下。拷贝完成后，这些文件就完全归用户所有——可编辑、可删除，但 **app 升级不会更新这些 skill 的内容**。

这带来三个问题：

1. **用户无法接收 skill 更新**：builtin skill（如 `create-ui-theme`、`create-agent-chat-theme`）的修订需要随 app 版本一起发布，但已存在的项目里的副本是旧版本，用户拿不到改进。
2. **阻碍 skill i18n 化**：如果未来要让 skill 内容随 locale 切换（见 backlog 「Presets i18n」），per-project 的用户文件会一直拖后腿——本地化必须发生在 app 内置的只读内容上。
3. **孤儿 skill `use-ui-sdk`**：`packages/presets/skills/use-ui-sdk/SKILL.md` 存在但未在 `presets.json` 声明，从未被注入，agent 也无法通过 `load_skill` 加载，事实上是一个被遗漏的内置 skill。

## 2. 目标

- builtin skill 改为 **app 内置只读内存源**，随 app 发版自动更新
- 保留用户在 `.spherse/skills/` 下自建 project-local skill 的能力
- 同名冲突时 project-local 覆盖 builtin，保护用户已有的自定义副本
- 启用 `use-ui-sdk`，使其可被 agent 加载
- 为未来 skill i18n 化扫清架构障碍（本次不实现 i18n，仅留 hook）

## 3. 非目标

- 不实现 skill 内容的 i18n（与 backlog 「Presets i18n」解耦，作为后续工作）
- 不新增 skill 管理 UI（前端目前只有 `load_skill` tool label，本次不变）
- 不引入版本号 / 内容指纹迁移机制（YAGNI）
- 不抽象 `ISkillSource` 接口（当前只有两个来源，不引入过度设计）

## 4. 架构设计

### 4.1 整体方案

`SkillStore` 从「单磁盘目录读取器」升级为「双源合并读取器」：内部读取 builtin（内存常量）与 project（磁盘）两个来源，按 `name` 去重后返回。

```
┌─────────────────────────────────────────────────────────────┐
│ SkillStore (packages/core/src/store/skill.ts)               │
│                                                             │
│   constructor(projectSkillDir, builtinSources?)             │
│                                                             │
│   list() / get(name) → 合并两源，project 优先               │
│                                                             │
│   ┌──────────────────────┐    ┌─────────────────────────┐   │
│   │ 磁盘源（project）    │    │ 内存源（builtin）       │   │
│   │ .spherse/skills/*    │    │ PRESET_SKILL_SOURCES    │   │
│   │ source: "project"    │    │ source: "builtin"       │   │
│   │ 用户可编辑           │    │ 只读，随 app 升级       │   │
│   └──────────────────────┘    └─────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
            ↑                          ↑
   ProjectStore 注入           @spherse/presets 导出
   (path.join(spherseDir,     PRESET_SKILL_SOURCES 不变，
    "skills"))                sync-templates.mjs 生成逻辑不变
```

**选择此方案（方案 A）而非其他**：
- 方案 B（在 ProjectStore/ProjectManager 层包装）：多一层抽象，下游消费方需要决定用哪个；契约面扩大
- 方案 C（`ISkillSource` 接口 + 多实现 + composite）：当前只有两个来源，属于过度设计（YAGNI）

方案 A 的优势：下游 `session-runtime.ts` 的 catalog 注入、`load_skill` tool、server routes 全部通过 `list()`/`get()` 调用，**零改动**即可自动获得合并结果。

### 4.2 组件改动

#### `packages/core/src/types.ts` — `SkillDefinition` 新增字段

```ts
export interface SkillDefinition {
  name: string;
  description: string;
  instructions: string;
  filePath: string;                    // builtin 用合成路径 "builtin://<dir>/SKILL.md"
  source: "builtin" | "project";       // 新增
}
```

`filePath` 对 builtin skill 仅为标识符（`builtin://create-ui-theme/SKILL.md`），不会被任何代码用于 `fs.readFile`。权威信号是 `source` 字段；`filePath` 仅作辅助。

#### `packages/core/src/store/skill.ts` — `SkillStore` 双源合并

构造器从 `constructor(skillDir)` 改为 `constructor(projectSkillDir, builtinSources?)`：

- 磁盘源沿用现状（`gray-matter` 解析 `.spherse/skills/*/SKILL.md`），`source: "project"`
- builtin 源在内存解析 `PRESET_SKILL_SOURCES`（已是 `{ dir, files: [{ relativePath, content }] }` 结构，找到 `relativePath === "SKILL.md"` 的条目解析），`source: "builtin"`，`filePath` 用 `builtin://<dir>/SKILL.md`
- `list()` 合并两源后按 `name` 去重，**同 name 时 project 覆盖 builtin**（实现上：先入 builtin，再用 project 覆盖）
- `get(name)` 返回 project-local（若存在）否则 builtin

**路径安全**：现有的 `skillMdPath.startsWith(this.skillDir)` 防穿越检查仅适用于磁盘源；builtin 源是内存常量，走 `builtin://` 协议前缀，不参与文件系统操作，无需该检查。

#### `packages/core/src/store/project.ts` — 注入 builtin sources

`new SkillStore(path.join(this.spherseDir, "skills"))` → `new SkillStore(path.join(this.spherseDir, "skills"), PRESET_SKILL_SOURCES)`。

#### `packages/core/src/presets.ts` — `initPresets()` 瘦身

删除 skill 文件拷贝块（原 12–24 行），改为：
- 保留 `fs.mkdir(path.join(spherseDir, "skills"), { recursive: true })` —— 继续创建空目录，方便用户后续自建 project-local skill
- 保留 preset agent 创建逻辑不变

#### `packages/presets/presets.json` — 启用 `use-ui-sdk`

```json
{
  "presetSkills": [
    { "dir": "create-ui-theme" },
    { "dir": "create-agent-chat-theme" },
    { "dir": "use-ui-sdk" }
  ],
  ...
}
```

`sync-templates.mjs` 的生成逻辑无需改动，会自动把 `use-ui-sdk` 纳入 `PRESET_SKILL_SOURCES`。

#### `packages/server/src/contracts/skills.ts` — 新增 `source` 字段

`skillDefinition` schema 新增：

```ts
source: Type.Union([Type.Literal("builtin"), Type.Literal("project")])
```

设为 required（builtin/project 之一）；旧 client 即使不识别也只会忽略该字段，不会出错。

### 4.3 不改动

- `PRESET_SKILL_SOURCES` 导出与 `sync-templates.mjs` 生成逻辑（继续生成 `{ dir, files: [{ relativePath, content }] }`）
- `packages/core/src/session-runtime.ts` 的 catalog 注入（line 165-171）
- `packages/core/src/tools/load-skill.ts` 的 `createLoadSkillTool` 工厂
- `packages/core/src/project-manager.ts` 的 `listSkills` / `getSkill` 代理
- 前端 `packages/app/src/lib/tool-registry.ts`（仅 tool label）
- `packages/presets/package.json` 的 `files: ["dist", "templates", "skills"]`（源 Markdown 仍随包发布）

## 5. 数据流与生命周期

### 5.1 新建项目

```
createProject()
  → projectStore.create()
  → initPresets()
      ├─ fs.mkdir(.spherse/skills/, { recursive: true })   // 保留空目录
      └─ 创建 preset agent                                 // 不再拷贝 skill 文件
```

新项目的 `.spherse/skills/` 是空目录，用户后续若想自定义可自建子目录 + SKILL.md。agent 此时通过 `SkillStore` 自动获得全部 builtin skill。

### 5.2 打开已有项目

```
open()
  → new SkillStore(projectSkillDir, PRESET_SKILL_SOURCES)
  → list():
      builtin = parseBuiltin(PRESET_SKILL_SOURCES)    // source: "builtin"
      project = readDisk(projectSkillDir)             // source: "project"
      merged = mergeByName(project, builtin)           // 同 name 时 project 覆盖 builtin
```

已有项目里的 `create-ui-theme` / `create-agent-chat-theme` 副本仍被读取，按 name 去重后 **project 版本覆盖 builtin**，用户此前对该副本的修改保留生效。用户若想接收 app 升级后的新版本，手动删除 `.spherse/skills/<name>/` 即可自动 fallback 到 builtin。

### 5.3 app 升级路径

- builtin skill 随 app 发版更新，新内容对所有项目立即可见（除非被 project-local 同名副本 shadow）
- **不需要任何 migration 脚本**，用户侧无感知
- 不做版本号对比、不做内容指纹判断——避免引入复杂度

### 5.4 agent 消费

`session-runtime.ts` 构建 system prompt 时调用 `SkillStore.list()`，自动获得合并后的全集；catalog 注入、`load_skill` tool 的 `get(name)` 行为均不变。同 name 下 project 版本被加载。

## 6. 冲突解决规则

按 `name`（frontmatter 中的 `name` 字段，不是目录名）作为去重键：

| 场景 | 结果 |
|------|------|
| project-local 与 builtin 同名 | project-local 覆盖 builtin |
| 多个 builtin 同名 | 按目录名字典序，后者覆盖前者，warn 一次（理论上不应发生，由 `presets.json` 维护者保证） |
| 多个 project 同名 | 按目录名字典序，后者覆盖前者，warn 一次 |

## 7. 错误处理

- **Builtin 源加载失败**：`PRESET_SKILL_SOURCES` 是编译期生成的 TS 常量（非运行时 I/O），不会失败。若 sync 脚本生成的内容为空，`list()` 返回的 builtin 列表为空数组，项目侧仍能正常工作，不阻断 agent 运行。
- **磁盘源读取失败**（沿用现状）：目录不存在或 SKILL.md 解析失败（缺 `name`/`description`）→ 该条目被静默过滤，不影响 builtin 列表。

## 8. 测试覆盖

沿用 TDD，在实现前先写测试：

- **`SkillStore` 双源合并**：
  - 纯 builtin（无 project 目录）
  - 纯 project（builtin 列表为空）
  - 合并 + project 覆盖 builtin（同 name）
  - 空场景（两源都空）
  - `get(name)` 返回 project-local（若存在）否则 builtin
- **`initPresets()`**：
  - 创建 `.spherse/skills/` 空目录
  - 不拷贝任何 preset skill 文件
  - 仍创建 preset agent（行为不变）
- **`presets.json` 启用 `use-ui-sdk`**：构建后 `PRESET_SKILL_SOURCES` 包含三个 skill（`create-ui-theme`、`create-agent-chat-theme`、`use-ui-sdk`）
- **现有 `session-runtime` / `load_skill` tool 测试**：行为不变，无需改动（如有断言需微调以包含新 `source` 字段）

## 9. 影响面

### 9.1 代码改动清单

| 文件 | 改动 |
|------|------|
| `packages/core/src/types.ts` | `SkillDefinition` 新增 `source` 字段 |
| `packages/core/src/store/skill.ts` | 构造器加 `builtinSources?` 参数；`list()`/`get()` 合并去重；builtin 走内存解析 |
| `packages/core/src/store/project.ts` | `new SkillStore(dir)` → `new SkillStore(dir, PRESET_SKILL_SOURCES)` |
| `packages/core/src/presets.ts` | 删除 skill 拷贝块，改为 `fs.mkdir(.spherse/skills/)`；保留 preset agent 创建 |
| `packages/presets/presets.json` | `presetSkills` 新增 `{ "dir": "use-ui-sdk" }` |
| `packages/server/src/contracts/skills.ts` | `skillDefinition` schema 新增 `source` 字段 |

### 9.2 死代码 / 测试清理

- `packages/core/src/__tests__/presets.test.ts` 中关于 skill 文件落盘的断言改为：断言 `.spherse/skills/` 目录被创建（空）+ 不含任何 preset skill 文件
- 其他既有测试若断言 `SkillDefinition` 结构需补 `source` 字段

### 9.3 文档同步（`docs/official/`）

- **`architecture.md`**（line 25 Skill 系统、line 29 预置内容注入）：描述改为「builtin skill 通过 SkillStore 内存合并，不再注入到 `.spherse/skills/`；用户仍可在 `.spherse/skills/` 自建 project-local skill」
- **`data-conventions.md`**（122–140、158–195）：`SkillDefinition` 新增 `source` 字段说明；`.spherse/skills/` 改为「用户自建 skill 目录（可选）」；移除「preset skill 注入」相关描述；移除「注入后的内容属于用户所有，app 升级不会覆盖」相关描述
- **`project-structure.md`**（line 50 `skills/ # 内置 skill`）：注释改为「内置 skill 源（app 内置，通过 SkillStore 内存合并）」

### 9.4 Backlog 维护

- 新增条目并标记为已完成：`[x] **内置 skill 真内置化**：将 preset skill 从 per-project 注入改为 app 内置只读`
- `use-ui-sdk` 的启用归并到本条目下；不与既有 line 53/54（Card 生成 skill / 主题制作 skill）混为一谈

## 10. i18n 关联说明

本次不实现 skill 内容的 i18n，与 backlog「Presets i18n」解耦。但 app 内置 skill 升级为 read-only 内存源后，未来做 skill 内容的 locale 化会更顺——本地化只需在 `PRESET_SKILL_SOURCES` 的生成阶段或 builtin 解析阶段按 locale 选择内容，不再受 per-project 用户文件拖累。本次设计为后续 i18n 留下 hook 点（builtin 源已是可控的内存常量）。
