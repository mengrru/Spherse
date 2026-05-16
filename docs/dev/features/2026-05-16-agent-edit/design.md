# Agent 编辑 Feature 设计

## 目标

支持编辑已有 agent 定义文件（当前只能创建）。

## 现状分析

- `AgentProfileStore.save(filename, content)` 已支持覆写：传入已有 filename 且 frontmatter 包含 `id` 时，保持 id 不变
- Server 仅有 `POST /api/agents/create` 和 `DELETE /api/agents/:id`
- 前端仅有 `CreateAgentDialog` 和 `createAgent()` API
- 无读取 agent 原始 markdown 内容的接口

## 设计

### 不改动的层

**core 层无需改动**：`save()` 已支持覆写，`getById()` 可按 id 查询。

### 新增接口

#### `GET /api/agents/:id/raw`

返回 agent 定义文件的完整 markdown 文本（frontmatter + body），用于填充编辑框。

- 路径：`server/src/routes/agents.ts`
- 实现：通过 `profileStore.getById()` 找到 `filePath`，读取文件原始内容返回

#### `PUT /api/agents/:id`

更新 agent 定义文件。

- 路径：`server/src/routes/agent-write.ts`
- Body：`{ content: string }`
- 实现：按 id 找到 agent 的 `filePath`，提取 filename，调用 `engine.saveProfile(filename, content)`
- 校验：content 非空，frontmatter 中必须包含 `id` 且与路径参数一致

### 前端改动

#### `AgentDialog`（原 `CreateAgentDialog`）

重命名组件，增加编辑模式支持：

- 新增 props：`mode: "create" | "edit"`、`initialContent?: string`
- 创建模式：使用 `AGENT_TEMPLATE` 作为初始内容，标题显示"创建 Agent"，按钮显示"创建"
- 编辑模式：使用 `initialContent` 填充 textarea，标题显示"编辑 Agent"，按钮显示"保存"

#### `api.ts`

- 新增 `updateAgent(id: string, content: string)` 方法，调用 `PUT /api/agents/:id`
- 新增 `getAgentRaw(id: string)` 方法，调用 `GET /api/agents/:id/raw`

#### `ProjectPage`

- Agent 右键菜单（···）新增"编辑"选项
- 点击后调用 `getAgentRaw(id)` 获取原始内容，打开 `AgentDialog(mode="edit")`
- 编辑成功后刷新 agent 列表

### 数据流

```
用户点击 Agent 菜单"编辑"
  → GET /api/agents/:id/raw（返回完整 markdown）
  → 打开 AgentDialog(mode="edit", initialContent=raw)
  → 用户编辑后提交
  → PUT /api/agents/:id（body: { content }）
  → server 按 id 找到 filename → engine.saveProfile(filename, content)
  → 返回 { ok: true }
```
