# Session 重命名 Design

## 背景

当前 session 已有 `title` 字段，并存储在项目根目录 `.spherse/sessions.db` 的 `sessions.title` 列中。`SessionStore` 已提供 `updateSessionTitle(sessionId, title)`，但该能力没有通过 `Engine`、Fastify API、renderer API client、项目数据 store 和侧边栏 UI 暴露给用户。

现有侧边栏会在 `SessionRow` 中展示 `session.title ?? new Date(session.updatedAt).toLocaleString()`，因此用户无法主动给会话命名，只能依赖默认时间显示或未来自动标题。

## 目标

- 用户可以从 session 行的更多菜单中触发重命名。
- 新标题持久化到 `.spherse/sessions.db`，应用重启后仍可展示。
- 重命名成功后，当前项目的 session 列表立即更新。
- 重命名不影响 session id、agent 关联、消息历史、当前 chat 路由和活跃 agent runtime。
- 保持现有 package 边界：server 只调用 `Engine`，app 只通过 API client 访问 server。

## 非目标

- 不实现自动根据首条消息生成标题。
- 不实现批量重命名或跨项目重命名。
- 不新增 session 详情页或独立元数据编辑面板。
- 不改变 session 排序规则；仍按 `updated_at DESC` 排序。

## 需求对齐

### 用户交互

在 agent/session 侧边栏中，每个 session 行现有更多菜单仅包含“删除”。新增“重命名”菜单项。点击后当前 session 行原地进入编辑态，标题文本替换为 input。input 默认值为当前 `session.title`；如果没有 title，则值为空，并通过 placeholder 展示当前回退标题，避免把时间误写成用户标题。

按 Enter 保存；按 Escape 或 input blur 取消并恢复普通展示态，不发送请求。提交成功后退出编辑态并更新列表。当前打开的 session 被重命名时，路由保持 `/project/:projectKey/chat/:sessionId` 不变。

### 标题规则

- 前后空白在提交前 trim。
- trim 后为空时拒绝提交，并在 UI 中提示用户输入名称；不把空字符串写入数据库。
- 最大长度建议限制为 80 个字符，防止侧边栏溢出和异常长数据写入。
- 允许同一 agent 下不同 session 使用相同标题；不做唯一性校验。

### 错误处理

API 请求失败时退出编辑态并弹 toast 告知失败原因，session 行恢复为保存前标题。项目数据 store 的 `error` 可同步记录错误，便于沿用现有错误状态处理方式。

如果 session 不存在，server 返回 404，前端弹 toast 展示失败信息，并可在后续刷新 sessions 时移除不存在的 session。

## 方案比较

### 方案 A：复用现有 `title` 字段并新增窄 API

新增 `Engine.renameSession(sessionId, title)`，调用 `SessionStore.updateSessionTitle`，server 暴露 `PATCH /api/sessions/:id` 或 `PUT /api/sessions/:id/title`，app API client 和 `project-data-store` 增加 `renameSession`。UI 在 `SessionRow` 菜单中增加重命名动作。

优点是改动小，完全复用现有数据模型，符合当前 core/server/app 边界。缺点是暂时只能修改标题，未来如果 session metadata 增多时可能需要扩展 API body。

### 方案 B：新增通用 session metadata update API

暴露 `PATCH /api/sessions/:id`，body 允许更新 `{ title }`，并为后续 metadata 字段预留扩展空间。

优点是 API 更通用。缺点是当前只有一个字段，容易过早设计；需要更明确的字段白名单和部分更新语义。

### 方案 C：前端本地别名

只在 renderer store 或 localStorage 记录 session id 到标题的映射，不改 core/server。

优点是实现最快。缺点是标题不会随项目数据迁移，不符合 session 数据持久化约定，也会造成同一项目不同应用实例展示不一致。

## 推荐方案

采用方案 A，但 server 路由使用 `PATCH /api/sessions/:id`，body 当前只接受 `{ title: string }`。这样保持本次实现聚焦，同时 API 形态可以自然扩展为 session 的部分更新，不需要引入额外的 `/title` 子资源。

## 架构设计

### Core

`SessionStore.updateSessionTitle(sessionId, title)` 需要返回是否实际更新到行，或由 `Engine` 在更新前先调用 `getSession` 判断 session 是否存在。推荐在 `Engine.renameSession` 中执行：

1. trim 并校验 title。
2. 查询 session，不存在则抛出 `Session "${sessionId}" not found`。
3. 调用 `sessionStore.updateSessionTitle(sessionId, title)`。
4. 返回更新后的 `SessionInfo`。

`updatedAt` 是否同步变化：本设计不更新 `updated_at`。重命名是元数据编辑，不代表对话活跃度变化；列表排序不应因为改名而改变。

### Server

在 `packages/server/src/routes/sessions.ts` 增加：

```ts
fastify.patch<{ Params: { id: string }; Body: { title?: string } }>(
  "/api/sessions/:id",
  async (req, reply) => {
    // validate req.body.title, call ctx.engine.renameSession, return SessionInfo
  },
);
```

校验规则：

- `title` 必须是 string。
- trim 后不能为空。
- trim 后长度不能超过 80。
- core 抛出 not found 时返回 404。
- 参数错误返回 400。

成功时返回更新后的 `SessionInfo`，让前端无需额外 fetch。

### App API Client

在 `createApiClient` 返回对象中新增：

```ts
renameSession(id: string, title: string): Promise<SessionInfo>
```

请求 `PATCH /api/sessions/:id`，body 为 `{ title }`。和现有 create/delete agent/session 方法一致，非 2xx 时读取 `{ error }` 并抛出 `Error`。

### Project Data Store

在 `useProjectDataStore` 增加：

```ts
renameSession(projectKey, client, sessionId, title): Promise<boolean>
```

成功后用 API 返回的 `SessionInfo` 替换当前项目 `sessions` 中同 id 的条目；如果当前列表不存在该 id，则可以把返回 session 插入列表顶部或直接刷新 sessions。推荐只替换已存在条目，避免 late refresh 或已清理项目时重新创建状态；不存在时调用 `refreshSessions` 由服务端列表兜底。

失败时设置 `error` 并返回 `false`。

### UI

`SessionRow` 新增 `onRename(session, title)` prop，并在 dropdown 中增加“重命名”。编辑态状态直接放在 `SessionRow` 内部，包含 `editing`、`draftTitle` 和 `saving`。`SessionRow` 只负责本行交互和本地校验，实际持久化仍通过上层传入的 `onRename` 完成。

进入编辑态时隐藏或禁用更多菜单，自动 focus input 并选中文本。input 使用侧边栏行内尺寸，避免改变列表布局。样式使用 Tailwind token，不新增原生 CSS class，不硬编码颜色。

Enter 提交时先 trim 并校验标题；空标题或超长标题属于本地输入错误，保留编辑态并在行内展示简短错误。提交中禁用 input，避免重复保存。Escape 或 blur 取消编辑。API 保存失败时由上层弹 toast，`SessionRow` 恢复普通展示态。

## 数据流

1. 用户在 `SessionRow` 更多菜单点击“重命名”。
2. `SessionRow` 原地进入编辑态并 focus input。
3. 用户输入 title 后按 Enter 提交。
4. `project-data-store.renameSession` 调用 `client.renameSession`。
5. API client 发送 `PATCH /api/sessions/:id`。
6. server 调用 `ctx.engine.renameSession`。
7. Engine 校验 session 存在并写入 `SessionStore`。
8. server 返回更新后的 `SessionInfo`。
9. store 替换本地 session 条目，sidebar 立即显示新标题。失败时上层弹 toast，行内恢复保存前标题。

## 测试计划

### Core

- `SessionStore.updateSessionTitle` 已有测试覆盖标题更新；如调整返回值，需要更新测试。
- 增加 `Engine.renameSession` 测试：成功返回更新后的 session；不存在 session 抛错；空标题和超长标题被拒绝。

### Server

- 覆盖 `PATCH /api/sessions/:id`：成功返回更新 session；缺失 title、空 title、超长 title 返回 400；不存在返回 404。

### App Store

- `project-data-store` 测试成功替换 session title。
- 测试失败时保留原 sessions 并写入 error。
- 测试项目已清理时 late rename response 不重新创建 project data。

### UI

- 组件测试或交互测试覆盖 session row 菜单触发原地编辑、Enter 提交、Escape/blur 取消、保存失败触发 toast。
- 手动验证侧边栏展示、当前 chat 路由不变、应用重启后 title 保留。

## 文档影响

`docs/official/data-conventions.md` 的 Session 数据段落应补充说明 `sessions.title` 是用户可编辑的可选展示标题，重命名不会改变 `updated_at`。如果实现时新增 API 行为，也可在架构文档的 Server 层保持现有描述，无需新增大段说明。

## 实施范围

预计涉及文件：

- `packages/core/src/engine.ts`
- `packages/core/src/store/session.ts`（仅在需要返回更新状态时调整）
- `packages/core/src/__tests__/engine.test.ts` 或相邻 core 测试文件
- `packages/server/src/routes/sessions.ts`
- `packages/app/src/lib/api.ts`
- `packages/app/src/stores/project-data-store.ts`
- `packages/app/src/stores/project-data-store.test.ts`
- `packages/app/src/features/agent-session-list/*`
- `docs/official/data-conventions.md`
- `docs/dev/backlog.md`

## 开放问题决策

- 空标题是否用于清除自定义标题：本设计不支持清除，空输入视为无效。后续如果需要“恢复默认时间显示”，可单独增加“清除标题”动作并允许数据库写入 `NULL`。
- 重命名是否改变排序：不改变，避免用户仅编辑标题导致列表跳动。
- 是否需要全局快捷入口：不需要，菜单入口足够覆盖当前需求。
