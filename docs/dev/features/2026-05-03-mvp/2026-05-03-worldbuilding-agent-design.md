# Worldbuilding Agent — 产品设计文档

**日期**：2026-05-03
**状态**：Draft

## 1. 产品定位

一个全平台、本地运行、开箱即用的 AI 辅助世界观创作桌面工具。目标用户为个人创作者（小说作者、TRPG主持人、游戏策划等），产品会推广给其他创作者使用。

### 核心价值

- **解决 context window 限制**：通过结构化的上下文管理，让 AI 按需读取世界观文件，而非一次性灌入
- **统一管理创作内容**：所有世界观设定、人物、故事碎片以纯文件形式组织，透明可编辑
- **可定制的 Agent 系统**：用户以 Markdown 定义不同角色的 AI agent，覆盖创作、角色扮演、定时任务等场景
- **开箱即用**：双击打开即可使用，无需技术背景

### 设计原则

- **纯文件优先**：创作内容以 Markdown/YAML 存储，用户可直接查看编辑，支持 git 版本控制
- **Agent 即 Markdown**：agent 定义是人类可读的 Markdown 文件，降低使用门槛
- **开箱即用**：无需预装 git 或其他依赖，所有功能内嵌
- **基于 pi 生态**：使用 pi-mono/agent 作为 agent loop 框架，pi-mono/ai 作为 LLM provider

## 2. 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 桌面壳 | Electron | 跨平台桌面应用，自动启动内嵌本地服务器 |
| 前端 | React | 对话界面、内容浏览、Agent 管理、项目设置 |
| 本地服务器 | Node.js (Fastify) | 前后端通信、多 session 调度、WebSocket 支持 |
| Agent 框架 | pi-agent-core (`Agent` 类) | Agent 实例管理、工具执行、事件流 |
| LLM Provider | pi-ai | 统一多 provider LLM 调用、流式响应、token 计费 |
| Session 存储 | SQLite (better-sqlite3) | 对话历史、session 元数据 |
| 内容存储 | 文件系统 (Markdown/YAML) | 世界观内容、agent 定义 |
| Git（后续） | isomorphic-git | 纯 JS git 实现，自动 commit/回滚 |

## 3. 项目文件结构

```
my-world/
├── AGENTS.md              # 目录索引 + 项目级指令（通用规范）
├── CHANGELOG.md           # 更新日志
├── .pi/
│   ├── project.yaml       # 项目元信息
│   ├── agents/            # Agent 定义（Markdown + YAML frontmatter）
│   │   ├── creator.md
│   │   └── alice-roleplay.md
│   └── sessions.db        # SQLite：session 历史、元数据、文件锁状态
├── (用户自定义目录和文件)
│   ├── 设定/
│   ├── 人物/
│   └── 故事/
```

### 系统文件说明

| 文件 | 必需 | 说明 |
|------|------|------|
| `AGENTS.md` | 是 | 项目目录索引和导航。人可读，agent 启动时优先加载此文件建立项目全貌认知 |
| `CHANGELOG.md` | 是 | 更新日志。每次 agent 操作自动追加记录（时间、agent、操作类型、影响范围） |
| `.pi/project.yaml` | 是 | 项目元信息（名称、创建时间、默认模型、路径配置等） |
| `.pi/agents/` | 是 | Agent 定义文件目录 |
| `.pi/sessions.db` | 自动生成 | SQLite 数据库，存储 session 数据 |

除系统文件外，用户完全自定义目录结构。`.pi/` 下的路径可在 `project.yaml` 中配置。

### project.yaml 格式

```yaml
name: 我的世界观
created: 2026-05-03
default_model: gemini-2.5-pro
paths:
  agents: agents/
  index: AGENTS.md
  changelog: CHANGELOG.md
```

## 4. Agent 定义

Agent 以 Markdown 文件定义，位于 `.pi/agents/` 目录下。

### 文件格式

```markdown
---
name: 世界创作者
model: gemini-2.5-pro
type: creator
tools:
  - read_file
  - write_file
  - list_files
  - search_content
  - append_changelog
context:
  - world/
  - characters/
output:
  path: stories/
  naming: "{{type}}-{{date}}-{{seq}}"
  frontmatter:
    type: auto
    author: agent
    status: draft
---

# 系统提示

你是一个世界观创作助手。你的任务是根据已有的世界设定和人物关系，
生成新的故事碎片、设定扩充、或其他创意内容。

## 创作风格

- 保持与已有设定的一致性
- 风格偏文学性，注重氛围感
```

### 字段说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | 是 | Agent 显示名称 |
| `model` | string | 否 | 使用的 LLM 模型（覆盖项目默认） |
| `type` | string | 是 | Agent 类型：`creator` / `roleplay` / `scheduler` / 自定义 |
| `schedule` | string | 否 | Cron 表达式，仅 scheduler 类型使用 |
| `tools` | string[] | 否 | 可用工具列表。不同 type 有不同默认值，用户可覆盖 |
| `context` | string[] | 否 | 上下文文件/目录范围，LLM 在此范围内自主决定读取哪些文件 |
| `output` | object | 否 | 生成内容的输出规则（路径、命名、frontmatter 模板） |
| 正文 | markdown | 是 | 作为 system prompt 传给 LLM |

### Agent 类型与默认工具权限

| 工具 | creator | roleplay | scheduler |
|------|---------|----------|-----------|
| `read_file` | ✅ | ✅ | ✅ |
| `write_file` | ✅ | ❌ | ✅ |
| `list_files` | ✅ | ✅ | ✅ |
| `search_content` | ✅ | ✅ | ✅ |
| `append_changelog` | ✅ | ❌ | ✅ |

### Agent 实例化与 Session

- 一个 agent 定义可以实例化多个 `Agent` 对象（来自 pi-agent-core），每个对象代表一个 session
- Session 数据（对话历史、元数据）存储在 `.pi/sessions.db`
- MVP 阶段不支持跨 session 共享 memory，但架构上通过 `transformContext()` hook 预留接口
- Session 与 agent 定义是多对一关系

## 5. 系统架构

```
┌──────────────────────────────────────────────┐
│                Electron Shell                 │
│  ┌─────────────────────────────────────────┐ │
│  │           Frontend (React)               │ │
│  │  ┌───────────┐ ┌──────────┐ ┌────────┐  │ │
│  │  │ 对话界面  │ │ 内容浏览 │ │ Agent  │  │ │
│  │  │           │ │   器     │ │  管理  │  │ │
│  │  └───────────┘ └──────────┘ └────────┘  │ │
│  │  ┌───────────┐ ┌──────────┐             │ │
│  │  │ 定时任务  │ │ 项目设置 │             │ │
│  │  │   面板    │ │          │             │ │
│  │  └───────────┘ └──────────┘             │ │
│  └─────────────────┬───────────────────────┘ │
│                    │ HTTP/WebSocket           │
│  ┌─────────────────▼───────────────────────┐ │
│  │         Local Server (Node.js)           │ │
│  │                                          │ │
│  │  ┌──────────────────────────────────┐   │ │
│  │  │        Agent Engine              │   │ │
│  │  │  (基于 pi-agent-core Agent类)    │   │ │
│  │  │                                  │   │ │
│  │  │  ┌─────┐ ┌─────┐ ┌─────┐       │   │ │
│  │  │  │Sess1│ │Sess2│ │Sess3│  ...  │   │ │
│  │  │  └─────┘ └─────┘ └─────┘       │   │ │
│  │  └──────────────────────────────────┘   │ │
│  │  ┌──────────────┐ ┌────────────────┐    │ │
│  │  │ Tool Registry │ │ File Lock Mgr │    │ │
│  │  └──────────────┘ └────────────────┘    │ │
│  │  ┌──────────────┐ ┌────────────────┐    │ │
│  │  │  Scheduler   │ │ Project Store  │    │ │
│  │  └──────────────┘ └────────────────┘    │ │
│  │  ┌──────────────┐ ┌────────────────┐    │ │
│  │  │ LLM Provider │ │  Session Store │    │ │
│  │  └──────────────┘ └────────────────┘    │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
         │
         ▼
   文件系统 (世界观项目文件夹)
```

### 模块职责

| 模块 | 职责 | 依赖 |
|------|------|------|
| **Electron Shell** | 窗口管理、菜单、自动启动/停止本地服务器 | Electron |
| **Frontend (React)** | UI：对话界面、内容浏览器、Agent 管理、定时任务面板、项目设置 | React |
| **Local Server** | API 层，前后端通信（HTTP + WebSocket），多 session 调度 | Fastify |
| **Agent Engine** | 解析 agent 定义 MD，创建/管理 pi-agent-core `Agent` 实例和 session | pi-agent-core |
| **Tool Registry** | 注册和管理所有 `AgentTool`（read_file, write_file, list_files, search_content, append_changelog） | pi-agent-core |
| **File Lock Manager** | 乐观锁实现，跟踪文件内容 hash，写入前校验 | — |
| **Scheduler** | Cron-like 调度，触发 agent 执行定时任务 | node-cron |
| **Project Store** | 封装项目元数据读写：project.yaml、AGENTS.md、agent 定义、CHANGELOG.md | — |
| **Session Store** | SQLite 封装，管理 session 对话历史、元数据、文件锁状态 | better-sqlite3 |
| **LLM Provider** | 统一 LLM 调用接口，多 provider 支持 | pi-ai |
| **Git Manager** | isomorphic-git 封装，自动 commit、diff、log、rollback、branch | isomorphic-git |

### 数据流

1. 用户在 Frontend 发起对话
2. Frontend 通过 HTTP/WebSocket 发送到 Local Server
3. Local Server 路由到对应 Agent Engine 的 session
4. Agent Engine 调用 pi-agent-core `Agent.prompt()`
5. Agent 通过 pi-ai 调用 LLM
6. LLM 返回响应，可能包含 tool call
7. Agent Engine 执行工具（read_file / write_file 等），通过 File Lock Manager 校验
8. 工具结果返回 LLM，循环直到完成
9. 最终响应通过 WebSocket 流式返回 Frontend
10. 如果有文件写入，自动追加 CHANGELOG 记录

## 6. 上下文管理策略

解决 Gemini 网页版 context window limitation 的核心设计：

1. **AGENTS.md 始终加载** — 体量小但信息密度高，作为项目全貌索引
2. **context 字段框定范围** — agent 定义中声明需要哪些目录/文件
3. **LLM 自主读取** — agent 通过 `read_file` / `list_files` / `search_content` 工具按需深入，而非一次性灌入所有内容
4. **摘要机制（后续）** — 当文件总量超过阈值时，自动生成摘要，先给 agent 看摘要，再按需展开

## 7. 文件竞态处理

采用**乐观锁**策略：

- 每次读取文件时，记录文件的内容 hash（存储在 SQLite 内存表中）
- session 请求 `write_file` 时，传入它之前读到的 hash
- 如果当前文件 hash 不匹配（被其他 session 修改），返回冲突错误
- LLM 收到冲突后自主决定如何处理：重新读取、合并、或写入新文件
- 类似 Git 的工作方式，但更轻量

## 8. Session 数据设计

### SQLite 表结构（`.pi/sessions.db`）

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT DEFAULT 'active'
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE TABLE file_locks (
  path TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  locked_by_session TEXT,
  updated_at INTEGER NOT NULL
);
```

## 9. Git 集成（Phase 2）

- 使用 isomorphic-git，纯 JS 实现，无系统依赖
- 自动 commit：每次 agent 通过 `write_file` 写入后自动 commit
- commit message 由 agent 生成或使用默认模板
- 支持查看 diff、历史 log、回滚、分支
- `.gitignore` 默认忽略 `.pi/sessions.db`

## 10. 网站生成（独立子项目）

- 作为独立模块/插件，不纳入核心架构
- 读取项目文件，生成沉浸式静态网站
- 网站本身套用世界观设定，成为世界观的一部分

## 11. 全平台策略

| 平台 | 方案 | 阶段 |
|------|------|------|
| macOS / Windows / Linux | Electron 桌面应用 | MVP |
| iOS / Android | Capacitor 或 React Native 复用核心逻辑 | 后续 |

核心逻辑（Agent Engine、Project Store、Session Store、Tool Registry、File Lock Manager）设计为与 UI 无关的纯 Node.js 模块，确保未来跨端复用。

## 12. 迭代计划

### Phase 1 — MVP

- 项目创建/打开/管理
- Agent 定义解析（读取 .pi/agents/*.md）
- 单 session 对话（基于 pi-agent-core Agent）
- 基本工具：read_file、write_file、list_files、search_content、append_changelog
- 内容浏览器（查看世界观文件）
- AGENTS.md 和 CHANGELOG.md 的自动管理

### Phase 2 — Git + 多 Session

- isomorphic-git 集成（自动 commit、diff、history、rollback、branch）
- 多 session 支持（同一 agent 多个对话）
- 文件竞态处理（乐观锁）

### Phase 3 — Scheduler + 增强

- 定时任务（cron 调度）
- 摘要机制（大文件集的上下文压缩）
- 跨 session 共享 memory

### Phase 4 — 网站生成 + 移动端

- 网站生成插件
- 移动端适配（Capacitor 或 React Native）
