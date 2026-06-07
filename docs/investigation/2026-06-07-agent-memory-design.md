# Design: Agent Memory

> 日期：2026-06-07
> 调研文档：[2026-06-07-agent-memory.md](./2026-06-07-agent-memory.md)
> 状态：待 review

## 目标

为每个 Agent 增加独立的 memory 功能。用户可在 Agent 编辑面板开启 memory，开启后 LLM 获得 memory 读写 tool，可在长期交互中积累和检索记忆。单个 Agent 的 memory 数据可达百兆级别。

## 前置条件

本设计依赖 **Agent 目录改造**（进行中）：每个 Agent 从单个 `.spherse/agents/{name}.md` 文件变为独立目录 `.spherse/agents/{name}/`。memory 数据存放在 Agent 目录下的 `memory/` 子目录。目录改造完成后才能开始本 feature 的实现。

## 设计原则

1. **分阶段交付**：Phase 1 只做 Core Memory（Markdown 文件），零外部依赖；后续 Phase 迭代增加语义检索
2. **Tool-first**：memory 操作作为 AgentTool 暴露，Agent 自主决定何时读写（Letta/AgeMem 模式）
3. **隔离性**：每个 Agent 的 memory 完全隔离，存储在各自目录下
4. **渐进式复杂度**：Phase 1 无数据库、无 embedding；用户看不到过渡期的粗糙

## Phase 1: Core Memory

### 概述

Core Memory 是始终加载到 system prompt 中的可编辑知识块。Agent 通过 tool 自行决定何时更新这些知识块。用户也可以直接编辑文件。

### 目录结构

```
.spherse/agents/{agent-name}/
├── profile.md                  # Agent 配置（目录改造后的位置）
├── memory/
│   └── core/
│       ├── persona.md          # Agent 对自身性格/角色的认知
│       ├── user-notes.md       # Agent 对用户偏好/习惯的了解
│       └── scratchpad.md       # Agent 的工作草稿（当前任务状态）
```

Core memory 文件为纯 Markdown，每个文件有固定用途但不硬编码名称——由 tool 参数 `block` 指定文件名。首次创建 memory 时自动生成默认块。

### AgentProfile 变更

在 `AgentProfile` 中新增 `memory` 字段：

```typescript
// packages/core/src/types.ts
export interface AgentProfile {
  // ...existing fields
  memory?: {
    enabled: boolean;
  };
}
```

对应 YAML frontmatter：
```yaml
memory:
  enabled: true
```

未设置 `memory` 或 `memory.enabled` 为 `false` 时，不注册 memory tool。

### Tool 设计

#### `core_memory_read`

读取指定核心记忆块的内容。

```typescript
const CoreMemoryReadParams = Type.Object({
  block: Type.String({ description: "记忆块名称，如 persona、user-notes、scratchpad" }),
});

function createCoreMemoryReadTool(agentDir: string): AgentTool
```

行为：
- block 参数仅允许 `[a-zA-Z0-9_-]` 字符，拒绝含 `.`、`/`、`\` 的名称
- 解析 block 参数为文件名 `{block}.md`
- 路径校验：`path.resolve(agentDir, "memory/core", block + ".md")`，确保 resolve 后的路径在 `memory/core/` 目录下
- 文件不存在时返回空内容提示

#### `core_memory_edit`

替换指定核心记忆块的全部内容。

```typescript
const CoreMemoryEditParams = Type.Object({
  block: Type.String({ description: "记忆块名称" }),
  content: Type.String({ description: "新的完整内容（Markdown 格式）" }),
});

function createCoreMemoryEditTool(agentDir: string, mutex: FileWriteMutex): AgentTool
```

行为：
- block 参数校验同 `core_memory_read`（仅 `[a-zA-Z0-9_-]`）
- 路径校验同上
- 使用 `FileWriteMutex` 防并发写
- 内容大小限制：单块最大 10KB（避免 context window 被单个块占满）
- 自动创建 `memory/core/` 目录（如不存在）
- 首次调用时自动创建三个默认块文件（空内容占位）：`persona.md`、`user-notes.md`、`scratchpad.md`

#### `core_memory_list`

列出所有可用的核心记忆块及其摘要（前 100 字符）。

```typescript
const CoreMemoryListParams = Type.Object({});

function createCoreMemoryListTool(agentDir: string): AgentTool
```

行为：
- 扫描 `memory/core/` 目录下所有 `.md` 文件
- 返回每个块的名称、大小、前 100 字符摘要
- 文件不存在时返回空列表

### Tool 注册

在 `Engine.buildAgent()` 中，根据 `AgentProfile.memory.enabled` 注册 memory tool：

```typescript
// packages/core/src/engine.ts - buildAgent() 内
const toolNames = profile.tools ?? Object.keys(allTools);
const tools: AgentTool[] = toolNames
  .map((name) => allTools[name])
  .filter(Boolean);

// Memory tool 在标准 tool 过滤之后追加，不受 profile.tools 限制
if (profile.memory?.enabled) {
  const agentDir = /* agent 所在目录，依赖目录改造 */;
  await fs.mkdir(path.join(agentDir, "memory", "core"), { recursive: true });
  tools.push(createCoreMemoryReadTool(agentDir));
  tools.push(createCoreMemoryEditTool(agentDir, this.fileWriteMutex));
  tools.push(createCoreMemoryListTool(agentDir));
}
```

Tool 位置：`packages/core/src/tools/core-memory-read.ts`、`core-memory-edit.ts`、`core-memory-list.ts`。

### System Prompt 注入

当 memory 开启时，将所有 core memory 块的内容注入 system prompt：

```
## Core Memory

以下是你的核心记忆，始终存在于你的上下文中。你可以使用 core_memory_edit 工具来更新这些记忆。

### persona
{persona.md 内容}

### user-notes
{user-notes.md 内容}

### scratchpad
{scratchpad.md 内容}
```

注入位置：在 agent 的 systemPrompt 之后、context 文件之前。在 `Engine.buildAgent()` 中处理。

注入时机：
- 新建 session 时读取并注入
- restore session 时读取并注入（确保 memory 变更反映到恢复的会话）

**注意**：Core memory 的更新不会实时反映在已注入的 system prompt 中（pi-agent-core 的 system prompt 是创建时设定的）。Agent 通过 tool 编辑 memory 后，变更将在下一个 session 才生效。这是 Phase 1 的限制，可接受。

### 前端变更

#### AgentDialog 编辑面板

在 `packages/app/src/components/AgentDialog.tsx` 中增加 Memory 开关：

- 位置：Tool Picker 下方
- 控件：一个简单的 toggle/switch
- 保存：`memory.enabled` 写入 YAML frontmatter

#### 前端 Tool Registry

在 `packages/app/src/lib/tool-registry.ts` 的 `ALL_TOOLS` 中增加三个 memory tool 的注册信息。

#### Memory 内容查看（可选增强）

可在 Agent 详情面板增加一个 tab 显示当前 memory 块内容（只读），方便用户查看 Agent 记住了什么。此为增强功能，Phase 1 可不做。

### 初始化流程

当用户首次为 Agent 开启 memory 时：

1. 前端更新 `AgentProfile` 的 `memory.enabled` 为 `true`
2. 下次 session 创建时，`Engine.buildAgent()` 检测到 `memory.enabled`
3. 自动创建 `.spherse/agents/{agent-name}/memory/core/` 目录
4. 创建三个默认块文件（空内容）：
   - `persona.md` — 内容为空，Agent 自行填充
   - `user-notes.md` — 内容为空，Agent 自行填充
   - `scratchpad.md` — 内容为空，Agent 自行填充

### 删除 Agent

删除 Agent 时（`Engine.deleteProfile()`），需要同时清理 memory 目录。在删除 profile 文件前，递归删除 `memory/` 子目录。

### 测试策略

- **单元测试**（`packages/core`）：
  - `core_memory_read` — 读取已有块、读取不存在块、block 名称校验、路径穿越防御
  - `core_memory_edit` — 创建新块、更新已有块、block 名称校验、大小限制、并发写安全
  - `core_memory_list` — 列出块、空目录
  - Tool 注册逻辑 — memory 开启/关闭时的 tool 过滤
  - System prompt 注入 — 确认 memory 内容正确拼接
- **集成测试**：完整的 session 生命周期，memory tool 可被调用

### 依赖变更

Phase 1 无新依赖。所有存储基于 Markdown 文件，使用 Node.js 内置 `fs` 模块。

---

## Phase 2: Semantic Memory（设计方向）

> 以下为方向性设计，具体细节在 Phase 1 完成后细化。

### 目标

增加语义记忆层，支持事实提取、向量化存储和语义检索。

### 新增存储

```
.spherse/agents/{agent-name}/memory/
├── core/                   # Phase 1 已有
├── semantic/
│   ├── facts.db            # SQLite + FTS5: 三元组 (subject, predicate, object) + 元数据
│   └── lancedb/            # LanceDB: 向量索引
```

### 新增 Tool

| Tool | 描述 |
|------|------|
| `memory_remember` | 提取并存储事实到语义记忆 |
| `memory_recall` | 混合检索（BM25 + 向量）所有层级记忆 |
| `memory_update` | 更新已有事实 |
| `memory_forget` | 失效一条记忆 |

### 新增依赖

- `vectordb`（LanceDB 的 Node.js 包）
- `@huggingface/transformers`（embedding 生成）

### Embedding 策略

- 模型：`paraphrase-multilingual-MiniLM-L12-v2`（384 维，~120MB，良好 CJK）
- 加载方式：`@huggingface/transformers` ONNX Runtime，首次使用时下载并缓存
- 进程级共享：模型实例在 Engine 层加载一次，所有 Agent 共享

### 检索策略

- SQLite FTS5 BM25 + LanceDB 向量搜索
- Reciprocal Rank Fusion (RRF) 融合排序
- `memory_recall` tool 触发检索，返回 top_k 结果注入 assistant 消息上下文

---

## Phase 3: 高级特性（设计方向）

> 以下为远期方向，Phase 2 完成后细化。

### 目标

增加事实时序追踪、后台整合、记忆衰减。

### 关键特性

- **时序有效性**：每条事实带 `valid_from` / `valid_to`，支持事实演化追踪
- **会话摘要**：session 结束时自动生成摘要存入 episodic memory
- **后台整合**：空闲时异步合并、压缩记忆
- **记忆衰减**：基于时间+访问频率的自动权重衰减

### 新增存储

```
.spherse/agents/{agent-name}/memory/
├── core/                   # Phase 1
├── episodic/
│   └── summaries.db        # SQLite + FTS5: 会话摘要
├── semantic/               # Phase 2
│   ├── facts.db
│   └── lancedb/
└── metadata.json           # 记忆统计信息
```

---

## 数据流

### Phase 1 数据流

```
用户开启 memory → AgentProfile.memory.enabled = true
                         ↓
Engine.buildAgent() → 检测 memory.enabled
                         ↓
              注册 core_memory_read/edit/list tool
                         ↓
              读取 memory/core/*.md → 注入 system prompt
                         ↓
LLM 对话中自主调用 core_memory_edit → 更新 Markdown 文件
                         ↓
下一个 session → system prompt 反映最新 memory 内容
```

### Phase 2 数据流（扩展）

```
用户发送消息 → LLM 生成回复
                    ↓
         LLM 判断需要记忆 → 调用 memory_remember(fact)
                    ↓
         extract-then-evaluate 管线：
           1. 生成 fact embedding
           2. 搜索相似已有记忆
           3. 判定：新增 / 更新 / 跳过
                    ↓
         写入 SQLite (三元组) + LanceDB (向量)
                    ↓
LLM 判断需要回忆 → 调用 memory_recall(query)
                    ↓
         混合检索：BM25(FTS5) + Vector(LanceDB) → RRF 融合
                    ↓
         top_k 结果返回给 LLM
```

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Agent 频繁调用 memory tool 增加延迟 | Phase 1 tool 操作简单文件读写，延迟 < 5ms |
| Core memory 占满 context window | 单块 10KB 上限 + 总量提醒（3 块 ~30KB ≈ 8K tokens） |
| Memory 内容不当（幻觉、错误事实） | 人类可读 Markdown，用户可直接查看和编辑 |
| Phase 2 embedding 模型增加包体积 | ~120MB 模型按需下载，仅 Phase 2 开启 |
| LanceDB 原生二进制兼容性 | Phase 2 才引入，有时间验证 Electron 环境兼容性 |
| Agent 删除时 memory 残留 | deleteProfile 时递归清理 memory 目录 |

---

## 文件变更清单

### Phase 1 变更

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `packages/core/src/types.ts` | AgentProfile 增加 memory 字段 |
| 新增 | `packages/core/src/tools/core-memory-read.ts` | Core memory 读取 tool |
| 新增 | `packages/core/src/tools/core-memory-edit.ts` | Core memory 编辑 tool |
| 新增 | `packages/core/src/tools/core-memory-list.ts` | Core memory 列表 tool |
| 修改 | `packages/core/src/tools/index.ts` | 导出新 tool |
| 修改 | `packages/core/src/engine.ts` | buildAgent 中注册 memory tool + 注入 system prompt |
| 修改 | `packages/core/src/engine.ts` | deleteProfile 中清理 memory 目录 |
| 新增 | `packages/core/src/memory/core-memory-store.ts` | Core memory 文件读写逻辑 |
| 修改 | `packages/app/src/lib/tool-registry.ts` | 注册新 tool 的 i18n key |
| 修改 | `packages/app/src/components/AgentDialog.tsx` | 增加 memory 开关 |
| 修改 | `packages/app/src/lib/agent-markdown.ts` | frontmatter 解析/构建支持 memory 字段 |
| 新增 | `packages/core/src/tools/__tests__/core-memory-read.test.ts` | 单元测试 |
| 新增 | `packages/core/src/tools/__tests__/core-memory-edit.test.ts` | 单元测试 |
| 新增 | `packages/core/src/tools/__tests__/core-memory-list.test.ts` | 单元测试 |

---

## 不在范围内

- **Context window 管理**：不在此 feature 中处理消息裁剪或摘要
- **跨 Agent 记忆共享**：每个 Agent 独立，不共享 memory
- **Memory UI 查看面板**：Phase 1 不做专门的 memory 查看页面，用户可通过文件系统查看
- **Memory 版本历史**：不追踪 memory 的变更历史
- **多用户**：当前为单用户桌面应用，不考虑权限隔离
