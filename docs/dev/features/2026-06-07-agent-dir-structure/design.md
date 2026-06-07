# Feature: 重新设计 Agents 目录结构

**日期**: 2026-06-07
**状态**: Design
**类型**: Breaking Change

## 背景

当前每个 agent 以单个 `.md` 文件存储在 `.spherse/agents/` 下：

```
.spherse/agents/
├── creator.md
├── historian.md
└── alice-roleplay.md
```

单文件结构无法支持未来的扩展需求（agent 专属 memory/状态文件、聊天窗口主题 CSS 等）。需要将 agent 从单文件改为目录结构。

## 目标

- 每个 agent 从单文件改为独立目录，`profile.md` 作为入口文件
- 目录名包含可读标识（初始 agent name）+ 短 UUID，创建后不再变
- `profile.md` 格式完全不变，降低改动成本
- 为未来扩展预留空间（memory、theme 等）

## 目录结构设计

### Before

```
.spherse/agents/
├── creator.md
├── historian.md
└── alice-roleplay.md
```

### After

```
.spherse/agents/
├── creator-a1b2c3/
│   └── profile.md
├── historian-f4e5d6/
│   └── profile.md
└── alice-roleplay-b7c8d9/
    └── profile.md
```

### 目录名规则

- 格式：`{slug}-{shortId}`
- `slug`：由初始 agent name 派生 — `name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")`（小写、空格替换为连字符、仅保留字母数字中文和连字符）
- `shortId`：agent UUID 的前 6 位
- 目录名在创建时生成，之后不再变
- 用户修改 agent 名字只更新 `profile.md` frontmatter 中的 `name` 字段

### 未来扩展示例

```
.spherse/agents/
├── historian-f4e5d6/
│   ├── profile.md     # agent 定义（frontmatter + system prompt）
│   ├── memory.md      # 持久化记忆（未来）
│   └── theme.css      # 聊天窗口主题（未来）
```

## 改动范围

### 1. `AgentProfile` 类型（`packages/core/src/types.ts`）

新增必填字段 `slug` 和 `createdAt`：

```typescript
export interface AgentProfile {
  // ...existing fields
  slug: string; // 目录名（如 "historian-f4e5d6"）
  createdAt: number; // 创建时间，Unix epoch milliseconds
}
```

### 2. `AgentProfileStore`（`packages/core/src/store/agent-profile.ts`）

#### `list()` 方法

- `readdir` 扫描子目录（过滤 `isDirectory()`），而非 `.md` 文件
- 每个子目录内读取 `profile.md` 并解析
- 跳过不含 `profile.md` 的目录

#### `save(slug, content)` 方法

- 解析 content 获取 `id` 和 `createdAt`（创建时若缺失则自动生成）
- 更新既有 profile 时，保留原 `id` 和 `createdAt`，不允许提交内容改写这两个不可变字段
- 取 `id.slice(0, 6)` 作为 shortId
- 构建目录名：若 slug 已以 `-{shortId}` 结尾则直接使用，否则构造 `{slug}-{shortId}`（区分创建与更新）
- 创建时如果 `{slug}-{shortId}` 已存在且指向不同 agent，拒绝写入，避免覆盖
- `mkdir -p {agentDir}/{dirName}`
- 写入 `{dirName}/profile.md`
- 返回时填充 `slug` 字段

#### `delete(id)` 方法

- 找到 profile 后，`rm -rf` 其父目录（`path.dirname(profile.filePath)`）

#### `parseFile()` 方法

- 不变，仍解析 `profile.md`
- 返回时从路径中提取 `slug`（`path.basename(path.dirname(filePath))`）

### 3. API 层（`packages/server/src/routes/agent-write.ts`）

#### `POST /api/agents/create`

- 请求 body 参数使用 `slug`（不含 `.md` 后缀），不再使用旧的 `filename`
- 校验规则：不含 `..`、不含路径分隔符、不为空
- 传入 `AgentProfileStore.save(slug, content)`

#### `PUT /api/agents/:id`

- 直接使用 `profile.slug` 传入 `AgentProfileStore.save(slug, content)`

#### `DELETE /api/agents/:id`

- 无需改动（Engine 层处理）

### 4. 前端（`packages/app`）

- `createAgent()` 传入纯 slug
- 其他 API 调用（getAgent, updateAgent, deleteAgent, listAgents）通过 id 操作，无需改动

### 5. 文档更新

| 文档 | 改动内容 |
|------|---------|
| `docs/official/data-conventions.md` | 更新 agent 存储路径（`{slug}-{shortId}/profile.md`） |
| `docs/official/project-structure.md` | 更新 agent-profile.ts 描述 |
| `docs/official/architecture.md` | 更新 AgentProfile 存储说明 |

### 6. 测试更新

- `packages/core/src/__tests__/store/agent-profile.test.ts` — 适配目录结构：
  - 创建时验证目录和 `profile.md` 存在
  - 列表时从目录结构读取
  - 删除时验证整个目录被移除
  - slug 字段正确填充
  - `createdAt` 创建时写入、读取时返回、更新时保持不变
  - 短 ID 目录碰撞、缺失必填 frontmatter、unsafe slug 等边界保护

## 不在范围内

- 数据迁移工具（破坏性改动，不提供迁移）
- memory / theme.css 的实现（仅预留目录结构）
- `manifest.yaml` 或 `config.json` 的引入
