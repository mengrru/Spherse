# 调研：Agent Memory 存储方案

> 日期：2026-06-07
> 状态：调研完成，待进入 brainstorming 阶段

## 1. 需求概述

为用户创建的每个 Agent 增加独立的 memory 功能：

- 每个 Agent 拥有独立目录 `.spherse/agents/{agent-name}/`（目录改造进行中）
- Memory 数据存放在 Agent 目录下
- 用户可在 Agent 编辑面板开启/关闭 memory
- 开启后，LLM 获得读写 memory 的 tool
- 长期使用场景下，单个 Agent 的 memory 可能达到 **百兆级别**

**核心问题**：该选择什么样的 memory 存储方案？

---

## 2. 现有架构分析

### 2.1 当前 Agent 数据模型

Agent 以 Markdown + YAML frontmatter 格式存储在 `.spherse/agents/*.md`：

```typescript
// packages/core/src/types.ts:15-30
interface AgentProfile {
  id: string;
  name: string;
  model?: string;
  type: string;
  schedule?: string;
  tools?: string[];      // Agent 可用的 tool 列表
  context?: string[];    // 注入 system prompt 的上下文文件路径
  output?: { path: string; naming: string; frontmatter?: Record<string, string> };
  systemPrompt: string;
  filePath: string;
}
```

### 2.2 当前 Tool 体系

所有 tool 在 `packages/core/src/tools/` 下，遵循工厂函数模式：

```typescript
function createXxxTool(projectRoot: string, ...): AgentTool
```

Tool 注册由 `createToolsForProject()` (`packages/core/src/tools/index.ts:25-47`) 统一装配，返回 `Record<string, AgentTool<any>>`。Engine 在创建 Agent 时根据 `AgentProfile.tools` 过滤可用 tool。

关键特性：
- Tool 参数 schema 使用 `@sinclair/typebox` 定义
- 文件操作 tool 共享 `FileWriteMutex` 防并发写
- 所有文件操作有 `path.resolve + startsWith` 路径安全校验

### 2.3 当前存储模式

| 数据 | 后端 | 位置 |
|------|------|------|
| 项目配置 | YAML | `.spherse/project.yaml` |
| Agent 配置 | Markdown + YAML | `.spherse/agents/*.md` |
| Skills | Markdown + YAML | `.spherse/skills/*/SKILL.md` |
| 会话 & 消息 | SQLite (better-sqlite3) | `.spherse/sessions.db` |
| 应用设置 | electron-store | Electron userData |

### 2.4 当前无 Memory 机制

- 所有对话历史以消息形式持久化到 SQLite
- Agent `context` 字段是静态注入，会话创建时一次性读取
- 无上下文窗口管理、无消息裁剪、无对话摘要

---

## 3. Memory 类型体系

学术与工业界在 2025-2026 年趋于统一的认知记忆模型：

### 3.1 记忆类型

| 类型 | 作用 | 类比 |
|------|------|------|
| **Core Memory（核心记忆）** | 始终在上下文中的可编辑知识块 | CPU 寄存器，~2-5K chars |
| **Episodic Memory（情景记忆）** | 过去交互的记录与摘要 | 对话日志压缩 |
| **Semantic Memory（语义记忆）** | 提取的事实、知识三元组 | 知识库 |
| **Procedural Memory（程序记忆）** | 学到的行为模式/偏好 | 行为习惯 |

### 3.2 推荐分层架构

```
┌─────────────────────────────────────────┐
│ Tier 1: Core Memory                     │  ← 始终在 system prompt 中
│ (Markdown files, ~2-5K chars per block) │     Agent 可自行读写编辑
├─────────────────────────────────────────┤
│ Tier 2: Episodic Memory                │  ← 按需检索
│ (SQLite + FTS5, session summaries)      │     关键词搜索
├─────────────────────────────────────────┤
│ Tier 3: Semantic/Archival Memory       │  ← 按需检索
│ (SQLite + LanceDB, facts & vectors)     │     混合检索（关键词 + 语义）
└─────────────────────────────────────────┘
```

---

## 4. 存储后端选型

### 4.1 候选方案对比

| 后端 | 优势 | 劣势 | 适用性 |
|------|------|------|--------|
| **SQLite + FTS5 + sqlite-vec** | 最快查询(0.1-1ms)、100% 召回、单文件零配置 | 向量搜索暴力扫描，>10万条时性能下降 | **优秀** |
| **LanceDB** | 唯一嵌入式 TS 向量数据库、磁盘存储、混合搜索、可扩展到百万级 | 原生二进制依赖，~2ms 查询，仍在 v0.x | **优秀** |
| **SQLite + JSON 列** | 简单，结构化查询 | 无原生向量搜索 | **良好**（结构化记忆） |
| **Markdown/JSON 文件** | 人类可读，git 友好 | 无搜索能力，不可扩展 | **仅适合 Core Memory** |
| **LevelDB** | 快速 KV | 无查询能力 | **不适合** |
| **ChromaDB** | 流行但 Python 优先 | Node.js 支持有限，需 Python 或服务端 | **不适合 Electron** |

### 4.2 推荐组合

| 用途 | 后端 | 理由 |
|------|------|------|
| Core Memory | Markdown 文件 | 人类可读、可 git 追踪、简单 |
| 结构化事实/三元组 | SQLite + FTS5 | 最快、最简单、项目已用 SQLite |
| 向量索引 | LanceDB | 唯一成熟的嵌入式 Node.js 向量数据库 |

**LanceDB 的关键优势**：
- Continue.dev（VS Code 插件）已验证在 Electron 环境下稳定运行
- 磁盘存储 + 内存映射，天然支持百兆级数据
- 原生 TypeScript/Node.js 库，无需 Python 或外部服务
- 内置混合搜索（向量 + FTS）和 RRF 融合排序

---

## 5. 检索策略

### 5.1 方案对比

| 策略 | 适用场景 | 性能 |
|------|----------|------|
| 全量加载 | 仅 Core Memory（<5K tokens） | 零延迟 |
| BM25 关键词搜索 | 精确术语匹配 | 0.1-1ms（SQLite FTS5） |
| 语义搜索（Embeddings） | 概念/语义级检索 | 1-5ms（LanceDB） |
| 混合搜索（BM25 + 向量） | **生产环境默认** | 1-3ms，最佳召回 |
| 混合 + Reranking | 需要高精度时 | 3-10ms，最高质量 |

### 5.2 推荐：混合检索 + RRF 融合

2025-2026 年 SOTA 方案（Mem0 v2、Zep/Graphiti）均采用多信号检索：

1. **BM25 关键词搜索**（SQLite FTS5）→ 精确匹配
2. **向量语义搜索**（LanceDB）→ 语义匹配
3. **Reciprocal Rank Fusion (RRF)** → 融合排序

LanceDB 内置 RRF hybrid fusion，无需额外实现。

---

## 6. Memory 管理机制

### 6.1 写入策略

推荐 **Mem0 的 extract-then-evaluate 管线**：

```
对话轮次 → 提取关键事实 → 评估（新增/更新/冗余）→ 存储净增量
```

- 每轮对话后提取关键事实（preference、fact、event）
- 与已有记忆做语义相似度比对
- 新增 → 存入；已有 → 更新；重复 → 跳过

### 6.2 整合/压缩

两种已验证的方案：

- **层级摘要**（MemTree/H-MEM）：构建多级表示，L1=摘要，L2=原文
- **后台整合**（Letta "sleep-time compute"）：空闲时异步反思、整合记忆

### 6.3 衰减/遗忘

推荐 **Zep/Graphiti 的双时序模型**：

- 每条事实带 `valid_from` / `valid_to` 时间戳
- 事实变更时旧条目失效（不删除），新条目生效
- 支持查询"某时间点什么是真的"
- 简化实现：为记忆附加 recency score + access count，逐渐降低旧记忆权重

### 6.4 冲突解决

新信息与已有事实矛盾时：
1. 语义搜索检测冲突
2. 时序元数据判断新旧
3. 旧条目失效（valid_to），新条目生效（valid_from）
4. 保留历史记录用于回溯查询

---

## 7. Embedding 模型选型

### 7.1 候选模型

| 模型 | 维度 | 大小 | 质量 | 多语言 | 集成方式 |
|------|------|------|------|--------|----------|
| **paraphrase-multilingual-MiniLM-L12-v2** | 384 | ~120MB | 良好 | **优秀 CJK** | `@xenova/transformers` |
| **EmbeddingGemma 300M** | 768 (Matryoshka) | ~200MB (Q8) | 最佳 <500M | 良好 | `node-llama-cpp` (GPU加速) |
| **bge-m3** | 1024 | ~560MB | 优秀 | **最佳多语言** | `@xenova/transformers` |
| **all-MiniLM-L6-v2** | 384 | ~23MB | 良好 | 仅英文 | `@xenova/transformers` |

### 7.2 推荐

- **Phase 1 (Core Memory)**：无需 embedding，纯文本
- **Phase 2 (初步语义搜索)**：`paraphrase-multilingual-MiniLM-L12-v2` via `@xenova/transformers`
  - ~120MB 模型大小，良好 CJK 支持，零服务端依赖
  - `@xenova/transformers` 在 Node.js 中通过 ONNX Runtime 运行，首次使用时下载模型并缓存
- **Phase 3 (高质量检索)**：可升级到 `bge-m3` 或 `EmbeddingGemma 300M` via `node-llama-cpp`（GPU 加速）

---

## 8. 现有框架参考

### 8.1 对比

| 框架 | 架构 | 本地优先 | Node.js | 最佳用途 |
|------|------|----------|---------|----------|
| **Mem0** | 提取-更新管线，向量+图+KV | 可自托管 | SDK | 用户偏好记忆 |
| **Letta (MemGPT)** | OS 式分层记忆，core/recall/archival | 可自托管 | TS SDK | 自编辑记忆的有状态 Agent |
| **Zep / Graphiti** | 时序知识图谱 (Neo4j) | OSS | SDK | 时间感知事实追踪 |
| **MemPalace-Node** | 层级记忆，SQLite/LanceDB，MCP | **完全本地** | **原生 TS** | Electron 兼容的本地记忆 |
| **LangChain / LangMem** | 模块化记忆组件 | 部分 | 是 | 快速原型 |

### 8.2 关键借鉴

- **Mem0**：extract-then-evaluate 管线 + 多信号检索算法设计
- **Letta/MemGPT**：Memory Blocks 概念 → 可编辑、固定在上下文中的记忆段落；memory 操作作为 tool
- **Graphiti**：时序知识图谱的双时序模型设计
- **MemPalace-Node**：直接可参考的 TypeScript 本地方案（SQLite + LanceDB），LongMemEval 96.6%

---

## 9. 推荐目录结构

```
.spherse/agents/{agent-name}/
├── profile.md                        # Agent 配置（现有，改造后从 .md 移入目录）
├── memory/
│   ├── core/                         # Tier 1: 核心记忆（始终在上下文中）
│   │   ├── persona.md                #   Agent 人设、性格
│   │   ├── user-profile.md           #   用户偏好、关键事实
│   │   └── active-context.md         #   当前任务/会话状态
│   ├── episodic/                     # Tier 2: 情景记忆
│   │   └── summaries.db              #   SQLite: 会话摘要 + FTS5
│   ├── semantic/                     # Tier 3: 语义记忆
│   │   ├── facts.db                  #   SQLite: 三元组 + 元数据 + FTS5
│   │   └── entities.json             #   实体注册表
│   └── vector/                       # 向量索引
│       └── lancedb/                  #   LanceDB 嵌入式向量存储
```

---

## 10. Memory Tool 设计

遵循现有 tool 体系（`AgentTool` 接口 + `@sinclair/typebox` schema），增加以下 tool：

| Tool | 描述 | 参数 |
|------|------|------|
| `memory_remember` | 存储新事实到语义记忆 | `fact: string, category?: string` |
| `memory_recall` | 混合检索所有层级记忆 | `query: string, top_k?: number` |
| `memory_update` | 更新已有事实（时序版本化） | `fact_id: string, new_content: string` |
| `memory_forget` | 删除/失效一条记忆 | `fact_id: string` |
| `core_memory_edit` | 编辑核心记忆块 | `block: string, content: string` |

Tool 注册逻辑：
- AgentProfile 新增 `memory?: { enabled: boolean }` 字段
- `createToolsForProject()` 在 `memory.enabled` 时额外注册 memory tool
- Memory tool 工厂函数接收 `agentDir: string` 参数，操作限定在 agent 目录下

---

## 11. 推荐实施路径

### Phase 1 — Core Memory（基础，无外部依赖）

- Markdown 文件存储核心记忆块
- `core_memory_edit` / `core_memory_read` tool
- 始终加载到 system prompt
- **无数据库、无 embedding、无额外依赖**
- 预估：2-4 周

### Phase 2 — Episodic + Semantic Memory（增加智能检索）

- SQLite + FTS5 存储结构化事实和会话摘要
- `@xenova/transformers` 本地 embedding 生成
- LanceDB 向量存储
- 混合检索（BM25 + 向量）
- 预估：4-6 周

### Phase 3 — 高级特性

- 事实时序有效性（Graphiti 风格）
- 后台整合（"sleep-time compute"）
- 记忆衰减与自动清理
- 实体提取与关联
- 预估：4-6 周

---

## 12. 百兆级别数据处理能力评估

| 组件 | 百兆级处理能力 | 说明 |
|------|---------------|------|
| LanceDB | **轻松处理** | 磁盘存储 + 内存映射，已验证百万级向量 |
| SQLite | **轻松处理** | 单文件数据库，百兆级零配置运行 |
| Embedding 模型 | **一次性开销** | ~120MB 模型加载一次，跨 Agent 共享 |
| 总存储占用 | ~220MB/Agent | embedding 模型(共享) + agent 记忆数据 |

**结论**：推荐方案完全可以支撑百兆级单 Agent 记忆。

---

## 13. 关键技术决策汇总

| 决策点 | 推荐方案 | 理由 |
|--------|----------|------|
| 向量数据库 | LanceDB | 唯一嵌入式 TS 向量数据库，Electron 已验证 |
| 结构化存储 | SQLite + FTS5 | 最快、最简、项目已用 |
| Embedding 模型 | multilingual-MiniLM via `@xenova/transformers` | ~120MB，良好 CJK，零服务端 |
| 核心记忆格式 | Markdown 文件 | 人类可读，可 git 追踪 |
| Memory 操作模式 | Letta/AgeMem 风格 Tool | Agent 自主决定何时记忆 |
| 检索策略 | 混合（BM25 + 向量 + 实体加权） | 多信号检索是 SOTA |
| 事实演化 | 双时序模型（valid_from/valid_to） | 处理事实变更的最佳实践 |

---

## 参考文献

1. "Memory in the LLM Era" (arxiv 2604.01707v2, 2026) — Agent Memory 统一框架
2. AgeMem (arxiv 2601.01885, 2026) — 基于 RL 的统一记忆管理
3. Mem0 (ECAI 2025) — extract-update 管线，多信号检索
4. Zep/Graphiti (2025) — 时序知识图谱，双时序模型
5. HyMem (arxiv 2602.13933, 2026) — 双粒度动态检索调度
6. Letta/MemGPT — Memory Blocks，分层架构，sleep-time compute
7. MemPalace-Node — TypeScript 本地记忆系统，LongMemEval 96.6%
8. EmbeddingGemma (Google, 2025) — 最佳 on-device embedding 模型
9. LanceDB — 嵌入式向量数据库，Node.js 原生
10. vecdb-bench — 嵌入式向量数据库基准测试
