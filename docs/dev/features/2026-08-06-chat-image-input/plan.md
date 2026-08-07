# Chat 图片输入 — 实施计划

日期：2026-08-06
设计文档：`docs/dev/features/2026-08-06-chat-image-input/design.md`

## 通用约定（所有任务遵守）

- **路径约定**：附件落盘目录 `.spherse/attachments/`，`Attachment.path` 存**项目相对路径含 `.spherse/` 前缀**（如 `.spherse/attachments/xxx.png`），与 `generate_image` 的 `.spherse/generated-images/` 一致，便于 `client.getPreviewUrl(path)` 直接服务。
- **路径安全**：所有路径解析用 `@spherse/core` 的 `resolveProjectPath` / `assertInsideProject`。
- **并发写入**：写文件用 `FileWriteMutex`。
- **不添加注释**（除非用户要求）。
- **类型**：严格 TypeScript，ESM。
- **每个任务结束必须**：跑对应 workspace 的 build + test + lint，全绿才算完成。
- **任务串行**：Task N 依赖 Task N-1 的类型编译产物，逐个推进，前一任务 verify 通过再开下一个。

---

## Task 1 — Core：AttachmentProcessor + LiveSession + SessionManager

**目标**：建立通用附件处理抽象，打通 LiveSession 多模态发送 + 落库/转发/内存三处剥离。

### 新建文件

- `packages/core/src/attachments/index.ts`
  - 导出 `Attachment`（`type`/`path`/`mimeType`/`meta?`）、`PreparedContentBlock`（image|text 联合）、`AttachmentProcessor`（`type`/`preprocess`/`placeholder`）
  - 导出 `attachmentProcessors: Record<string, AttachmentProcessor>`（注册 image）
  - 导出 `stripUserAttachments(userMessage, attachments)`：把完整 user 消息剥离为 content 全文本 + `_attachments` 字段（见 design §3）
- `packages/core/src/attachments/image-processor.ts`
  - `createImageAttachmentProcessor()`：`preprocess` → `resolveProjectPath` + `assertInsideProject`（必须落在 `.spherse/attachments/` 下）+ 读文件 base64 → `[{type:"image",data,mimeType}]`；`placeholder` → `"（已附带图片）"`

### 编辑文件

- `packages/core/src/session/live-session.ts`
  - `sendMessage(message, attachments = [], onEvent)`：先 preprocess 所有 attachments → 构建完整 `UserMessage`（content = [text, ...image blocks]）→ `agent.prompt(userMessage)`（用 message 重载）
  - `message_end` 监听器：user 消息且 `attachments.length>0` 时，落库 + `onEvent` 转发**都用剥离版**（捕获 `fullUserMsg` 引用）；其余维持原逻辑（design §3 ①②）
  - `agent.prompt` resolve 后：通过 `this.agent.state.messages = ...map(m => m===fullUserMsg ? stripped : m)` 改写内存（design §3 ③）
  - `buildAgent`（:376 `new Agent({...})`）注入 `convertToLlm`：剥离 `_attachments` + 丢弃空 data image 块 + role 过滤（design §4）
- `packages/core/src/session/session-manager.ts`
  - `sendMessage(sessionId, message, attachments?, onEvent)` 透传 attachments
- `packages/core/src/index.ts`
  - `export type { Attachment }`（外部仅作类型用 → `export type`）

### 测试（新建）

- `packages/core/src/__tests__/attachments/image-attachment-processor.test.ts`
  - preprocess 返回正确 ImageContent；路径越界（不在 `.spherse/attachments/`）抛错；placeholder 文本固定
- `packages/core/src/__tests__/session/live-session-attachments.test.ts`（或扩展既有 live-session 测试）
  - 带 image attachment：`agent.prompt` 收到含真实 ImageContent 的 UserMessage（mock agent）
  - 落库的是剥离版（无 base64、content 全文本、`_attachments` 含 path）
  - `onEvent` 转发的是剥离版
  - 轮后 `agent.state.messages` 末尾 user 消息被改写为剥离版
  - convertToLlm 剥离 `_attachments`、丢弃空 data image 块、保留本轮完整 image 块

### 验证

```bash
npm run build --workspace=packages/core
npm test --workspace=packages/core
npm run lint --workspace=packages/core
```

### 依赖

无（基础层，最先做）

---

## Task 2 — Server：WS 契约 + Hub 透传 + 上传路由

**目标**：扩展 WS 契约承载 attachments，hub/ handler 透传到 SessionManager；新增通用附件上传/删除路由。

### 前置

Task 1 完成（`Attachment` 类型从 `@spherse/core` 可导入）。

### 编辑文件

- `packages/server/src/contracts/websocket.ts`
  - `chatClientMessage` 的 message 变体增加可选 `attachments: Type.Optional(Type.Array(Type.Object({ type, path, mimeType })))`（design §5）
- `packages/server/src/chat-session-hub.ts`
  - attachment 接口 `sendMessage(content, attachments?)`、`startRun(content, attachments?)` 透传到 `runtime.sendMessage(sessionId, content, attachments, cb)`
- `packages/server/src/ws-chat.ts`
  - `"message"` 分支：`await attachment.sendMessage(msg.content, msg.attachments ?? [])`

### 新建文件

- `packages/server/src/routes/attachments.ts`
  - `POST /api/projects/:projectId/attachments`：multipart field `file` → 校验 mimeType ∈ {png,jpeg,webp} + ≤5MB → 文件名 `{ts}-{hex8}.{ext}` → 写 `<root>/.spherse/attachments/`（`assertInsideProject` + `FileWriteMutex`）→ 返回 `{ type:"image", path:".spherse/attachments/xxx.png", previewUrl, width, height, bytes }`
    - width/height：用图片尺寸探测（`probe-image-size` 不可用就用轻量读 PNG/JPEG header，或让前端传；优先前端传 meta，后端兜底 sniff）
  - `DELETE /api/projects/:projectId/attachments`：body `{path}` → `assertInsideProject` + 必须在 `.spherse/attachments/` 下 → 删除
  - 参考 `packages/server/src/routes/images.ts`（export 路由）的注册与鉴权风格
- 注册：`packages/server/src/index.ts` 调用 `registerAttachmentsRoutes(...)`

### 测试（新建）

- `packages/server/src/routes/attachments.test.ts`
  - POST 合法图片 → 200 + 返回结构正确；非图片 mimeType → 4xx；超 5MB → 4xx；路径穿越 → 拒绝
  - DELETE 删除已上传文件；越界路径 → 拒绝
- WS contract 测试：`parseChatClientMessage` 接受带 attachments 的 message；拒绝畸形 payload

### 验证

```bash
npm run build --workspace=packages/server
npm test --workspace=packages/server
npm run lint --workspace=packages/server
```

---

## Task 3 — App Spine：压缩 util + 类型 + store/runtime plumbing + API client

**目标**：建立前端"附件流"的骨架（类型、压缩、上传客户端、store/runtime/useChatSession 透传），暂不动 Composer/MessageItem UI。

### 前置

Task 2 完成（WS 契约已支持 attachments）。

### 新建文件

- `packages/app/src/features/chat/utils/compress-image.ts`
  - `compressImage(file): Promise<{ blob, width, height, mimeType:"image/jpeg" }>`：纯 Canvas，long edge ≤1568、JPEG q0.82、≤~1MB（循环降 quality 到 q0.5 底线），零依赖
  - 测试：mock Canvas，断言长边 ≤1568、输出 JPEG、体积达标

### 编辑文件

- `packages/app/src/features/chat/types.ts`
  - `ChatMessage` 增 `_attachments?: Array<{ type:"image"; path:string; mimeType:string; width?:number; height?:number }>`
  - 导出 `AttachedImage` 类型（Composer 待发送图片用）
- `packages/app/src/lib/api.ts`
  - 新增 `uploadAttachedImage(blob, meta): Promise<{ type, path, previewUrl, width, height, bytes }>`（multipart POST `/api/projects/:id/attachments`）
  - 新增 `deleteAttachment(path): Promise<void>`（DELETE）
  - 参考 `exportImage`(:311) 的 authedFetch 风格
- `packages/app/src/features/chat/runtime/streaming-store.ts`
  - `sendMessage(sessionId, text, image?)`：乐观 user 消息带 `_attachments`（image ? `[{type:"image", path, mimeType, width, height}]` : undefined）；调 `runtime.sendMessage(text, image?)`
- `packages/app/src/features/chat/runtime/chat-session-runtime.ts`
  - `sendMessage(content, image?)`：WS payload `{ type:"message", content, attachments: image ? [{type:"image", path: image.path, mimeType: image.mimeType}] : undefined }`
- `packages/app/src/features/chat/hooks/useChatSession.ts`
  - `sendMessage(text, image?)` 透传到 store

### 验证

```bash
npm run lint --workspace=packages/app
npm test --workspace=packages/app
```

（注：本任务后 app 应能编译；Composer 仍只传 text，image 参数可选不破坏现状）

---

## Task 4 — App UI：Composer 附件 + 模型 gating + MessageItem 展示

**目标**：完成用户可见的附件交互。

### 前置

Task 3 完成（store/runtime/类型骨架就绪）。

### 新建文件

- `packages/app/src/features/chat/hooks/useSessionModelCapability.ts`（或在 chat session hook 内 expose）
  - 解析当前 agent 的 model id（`AgentProfile.model` + default model）→ 查 provider catalog（`getSupportedProviders()` / 既有 settings 数据）的 `models[].input: ("text"|"image")[]` → 返回 `{ supportsVision: boolean }`
  - 实现前先探索 chat 上下文里 agent model id 与 catalog 的实际可达路径
- （可选）`packages/app/src/features/chat/AttachmentBar.tsx`：缩略图条子组件（若 Composer 超 ~150 行则拆出）

### 编辑文件

- `packages/app/src/features/chat/Composer.tsx`
  - 附件按钮（`Paperclip`）+ 隐藏 `<input type="file" accept="image/*">`
  - `useState<AttachedImage | null>` + 状态机（idle/compressing/uploading/ready/error）
  - 已附图：textarea 上方缩略图条 + × 删除（调 `deleteAttachment`）
  - `onSend` 调 `sendMessage(text, image)`，发送后清空 image state
  - `compressing/uploading` 禁用发送按钮
  - gating：`!supportsVision` 时附件按钮禁用 + tooltip「当前模型不支持图片」
- `packages/app/src/features/chat/MessageItem.tsx`
  - user 消息：读 `chatMessage._attachments`，文字下方渲染缩略图 `<img src={client.getPreviewUrl(path)}>`；点击放大用 `createPortal(..., document.body)` 全屏 viewer（避开宿主 backdrop-filter/transform 的 containing block 问题）

### 测试

- Composer：附件按钮交互、状态机、gating 禁用
- MessageItem：`_attachments` 渲染缩略图

### 验证

```bash
npm run lint --workspace=packages/app
npm test --workspace=packages/app
```

---

## 收尾（Task 4 后）

### 全量验证

```bash
npm run build           # 所有 package
npm run lint            # 全仓库
npm test --workspace=packages/core
npm test --workspace=packages/server
npm test --workspace=packages/app
```

### 文档同步（AGENTS.md 要求）

- `docs/official/project-structure.md`：`core/src/` 加 `attachments/` 目录条目；`server/src/routes/` 加 `attachments.ts`
- `docs/dev/backlog.md`：新增 chat 图片输入条目并标记完成
- 检查 `docs/official/` 是否有 chat 协议/消息格式文档需补 `_attachments` 约定

### 不在本次范围

- 粘贴 / 拖拽上传、一条消息多图、PDF 等其它 processor、附件磁盘 GC、PNG 透明度保留（见 design 非目标）

---

## 任务依赖图

```
Task 1 (core) ──► Task 2 (server) ──► Task 3 (app spine) ──► Task 4 (app UI)
                                                              │
                                                              └──► 收尾验证 + 文档
```
