# Chat 图片输入（Vision Input）

日期：2026-08-06

## 背景

当前 chat 全链路只支持文本输入：Composer 是纯 textarea，WS 契约 `content: Type.String()`，`LiveSession.sendMessage(message: string)` → `agent.prompt(message)`。用户无法向 agent 发送图片让其"看图说话"。

底层其实已具备 vision 能力但未接通：

- pi-agent-core `Agent.prompt(input: string, images?: ImageContent[])` 与 `prompt(message: AgentMessage)` 重载都支持多模态（`node_modules/@earendil-works/pi-agent-core/dist/agent.d.ts:104-105`）。
- pi-ai `UserMessage.content: string | (TextContent | ImageContent)[]`（`pi-ai/dist/types.d.ts:265-269`）。
- SQLite 存储的 `AgentMessage` JSON 本就支持内容块（`packages/core/src/store/session.ts:189-222`）。
- 模型能力字段 `Model.input: ("text" | "image")[]` 已进入 catalog（`packages/core/src/types.ts:144`），但 UI 从未读取。
- 图片**输出**（生成）已完整实现：`generate_image` 工具落盘到 `.spherse/generated-images/` + `ImageCard` 走 preview URL 展示（`packages/core/src/tools/generate-image.ts`、`packages/app/src/features/chat/ImageCard.tsx`）。

## 目标

1. 用户在 Composer 通过文件选择按钮附一张图片，随文本一起发送给 agent。
2. 前端压缩图片（Canvas，零依赖），控制体积。
3. **助手回复后，后续轮次的 LLM 上下文不再携带图片数据**（省 token），但聊天历史气泡仍显示原图。
4. 当前 agent 的模型不支持 vision 时，阻止发送并提示。
5. 引入通用 **AttachmentProcessor** 抽象，图片是首个实现，未来加 PDF 等附件类型不动链路。

## 非目标

- 不做粘贴 / 拖拽上传（仅文件选择按钮）。
- 不支持一条消息附多张图（每条消息最多一张）。
- 不实现 PDF / 其它附件类型 processor（仅留抽象 seam，PDF 等为 follow-up）。
- 不做附件磁盘 GC（孤儿文件清理留作后续）。
- 不改 `generate_image`（图片输出）链路。

## 现状分析（关键链路）

消息发送全链路（逐层均硬编码 `string`）：

```
Composer.onSend(message:string)
  → useChatSession → streaming-store.sendMessage(sessionId, text)   // 乐观插入 user 消息
    → ChatSessionRuntime.sendMessage(content) → WS {type:"message", content:string}
      → ws-chat.ts: parseChatClientMessage → attachment.sendMessage(content)
        → ChatSessionHub.startRun(content)
          → SessionManager.sendMessage(sessionId, message, onEvent)
            → LiveSession.sendMessage(message, onEvent)
              → agent.prompt(message)        // 仅 string，未用 images 重载
```

关键文件：

| 层 | 文件:行 |
|---|---|
| Composer | `packages/app/src/features/chat/Composer.tsx:13-19,72-99` |
| streaming-store | `packages/app/src/features/chat/runtime/streaming-store.ts:39,282-305` |
| WS client | `packages/app/src/features/chat/runtime/chat-session-runtime.ts:230-234` |
| WS 契约 | `packages/server/src/contracts/websocket.ts:110-121` |
| ws-chat handler | `packages/server/src/ws-chat.ts:56-93` |
| ChatSessionHub | `packages/server/src/chat-session-hub.ts:21-30,133-151` |
| SessionManager | `packages/core/src/session/session-manager.ts:66-74` |
| LiveSession | `packages/core/src/session/live-session.ts:144-167`（`agent.prompt(message)` 在 :161） |
| ChatMessage UI 类型 | `packages/app/src/features/chat/types.ts:59-70`（`content: string`） |

持久化与上下文重建：

- 存储：SQLite，`appendMessage` 把整个 `AgentMessage` `JSON.stringify` 入 `content` TEXT 列（`packages/core/src/store/session.ts:189-222`），schema-versioned。
- 历史重建：`LiveSession.restore`（`live-session.ts:107-138`）从 DB 按序加载赋给 `agent.state.messages`；有 compaction 时用 digest 文本消息替换旧区段。
- 上下文管理：唯一机制是 compaction（75% 阈值 + 20 轮，`packages/core/src/context/compaction.ts:104-145`），把旧消息摘要成文本；UI 历史分页读 DB 原始行，不受 compaction 影响。
- `convertToLlm`：Spherse 未自定义，用 pi-agent-core 默认（按 role 过滤，消息体原样透传）。

## 设计方案

### 总体思路：落盘 + 存储剥离

图片 base64 只在「发送瞬间」短暂存在（内存 + 本轮 LLM 调用），落库即剥离为**文本占位 + `_attachments` 路径引用**。展示永远走磁盘 preview URL，与 LLM 上下文完全解耦。复用 `generate_image` 已验证的「图片落盘 + preview URL」模式。

图片数据在三个时机的一致性：

| 时机 | agent.state.messages 里的 user 消息 | DB 里的 user 消息 |
|---|---|---|
| 本轮发送中（LLM 调用前） | 完整：`content` 含真实 `ImageContent(base64)` | （尚未落库） |
| `message_end(user)` 落库时 | — | **剥离版**（content 文本占位 + `_attachments`） |
| 轮后（助手回复完） | **改写为剥离版**（与 DB 对齐） | 剥离版 |

→ 同一进程下一轮、以及重启 restore，`agent.state.messages` 都是剥离版，上下文天然便宜。

### 1. Core：通用附件模块 `packages/core/src/attachments/`

定义可扩展的处理器抽象，图片是首个实现：

```ts
export interface Attachment {
  type: string                 // "image" | "pdf" | ...
  path: string                 // 项目相对路径（含 .spherse/ 前缀），如 ".spherse/attachments/xxx.png"
  mimeType: string
  meta?: Record<string, unknown>  // 各 processor 自定义（如 image 的 width/height）
}

// preprocess 产出的、要塞进 UserMessage.content 的内容块
export type PreparedContentBlock =
  | { type: "image"; data: string; mimeType: string }   // → pi-ai ImageContent
  | { type: "text"; text: string }                       // → pi-ai TextContent（如 PDF 抽出的文本）

export interface AttachmentProcessor {
  readonly type: string
  /** 上传后、发送 LLM 前：把 path 转成 LLM 可消费的内容块 */
  preprocess(ctx: { projectRoot: string; attachment: Attachment }): Promise<PreparedContentBlock[]>
}

export const attachmentProcessors: Record<string, AttachmentProcessor> = {
  image: createImageAttachmentProcessor(),
}
```

**ImageAttachmentProcessor**（`createImageAttachmentProcessor`，本期唯一实现）：

- `preprocess`：`resolveProjectPath(projectRoot, attachment.path)` + `assertInsideProject`（必须落在 `.spherse/attachments/` 下）→ 读文件 → `data.toString("base64")` → 返回 `[{ type:"image", data, mimeType: attachment.mimeType }]`。

> 落库剥离时**不**在 content 里塞任何占位文本——剥离版 content 仅保留用户原始文本，附件信息只走 `_attachments` 字段（前端据此决定展示，core 不掺入展示文案）。未来加 PDF 只需新增 `createPdfAttachmentProcessor()` 并注册；LiveSession / WS / 链路一行不改。

### 2. LiveSession 改用 `prompt(message)` 重载 + processor 驱动

`packages/core/src/session/live-session.ts`：

- `sendMessage` 签名：`(message: string, attachments: Attachment[] = [], onEvent: AgentEventHandler) => Promise<void>`。
- 不再用 `agent.prompt(text, images)` 的 image 特化重载；改用 `prompt(message: AgentMessage)` 重载构建完整多模态 UserMessage，天然支持未来 text/image 混合块。
- **附件预处理与消息组装下沉到 `attachments` 模块**（`prepareAttachmentUserMessage`），LiveSession 只调用、不内联组装，避免侵入其原有的「agent 生命周期 / 持久化 / compaction」职责边界。剥离/轮后改写同理复用 `stripUserAttachments`；但「在 message_end 监听里落库+转发剥离版、prompt resolve 后改写内存」这一步耦合 LiveSession 自有资源（`agent.subscribe` / `agentStore.sessions.appendMessage` / `agent.state.messages`），仍留在 LiveSession 内：

```ts
async sendMessage(message, attachments = [], onEvent) {
  // 1. 附件预处理 + 组装多模态 UserMessage（下沉到 attachments 模块）
  const userMessage = await prepareAttachmentUserMessage(message, attachments, this.ctx.projectRoot)
  // 2. 订阅 message_end：user 落【剥离版】(见 §3)，assistant 正常落
  // 3. await agent.prompt(userMessage)
  // 4. 轮后改写内存 user 消息为剥离版（与 DB 对齐，见 §3）
}
```

- `projectRoot` 经 `this.ctx.projectRoot` 可得（`session/types.ts:10`，`live-session.ts:319` 已有用法），无需新增注入。

### 3. 落库剥离、转发剥离、轮后内存改写

> **关键事实（已读 pi-agent-core 源码验证）**：
> - `prompt(input)` 对非字符串/非数组的消息对象走 `normalizePromptInput` → 返回 `[input]`（`agent.js:248-260`），即 `prompt(userMessage)` 重载可用。
> - pi-agent-core 在 `message_end` 时**自己**把 `event.message` push 进 `agent._state.messages`（`agent.js:368-371`）。也就是说完整带图 user 消息会进入内存 state。
> - 现有 LiveSession 监听器（`live-session.ts:151-158`）对每个 `message_end` 既 `appendMessage(event.message)` 落库，又 `onEvent(event)` 转发给 WS 客户端——**若不处理，完整 base64 既会进 DB 又会上线路**。

因此对带附件的 user `message_end` 要同时处理**落库**、**WS 转发**、**轮后内存**三处，统一用剥离版：

**剥离函数**（core 侧，复用于三处）：

```ts
// 输入：本轮完整 user 消息 + 它携带的 attachments
// 输出：剥离版 message（content 仅保留原始文本 + _attachments 路径引用）
function stripUserAttachments(userMessage: UserMessage, attachments: Attachment[]): UserMessage {
  const originalTextBlocks =
    typeof userMessage.content === "string"
      ? [{ type: "text", text: userMessage.content }]
      : userMessage.content.filter(c => c.type === "text")
  return {
    ...userMessage,
    content: originalTextBlocks,
    _attachments: attachments,   // Spherse 自有约定字段（下划线开头=非 pi-ai 标准）
  } as UserMessage
}
```

**sendMessage 内的监听器改造**（伪代码）：

```ts
let fullUserMsg: UserMessage | undefined      // 闭包捕获完整 user 消息引用
const unsubscribe = this.agent.subscribe((event) => {
  logAgentEvent(sessionLogger, event)
  if (event.type === "message_end") {
    if (event.message.role === "user" && attachments.length > 0) {
      fullUserMsg = event.message                                 // 捕获引用（供轮后改写）
      const stripped = stripUserAttachments(event.message, attachments)
      const msgId = agentStore?.sessions.appendMessage(this.sessionId, stripped)  // ① DB 落剥离版
      if (msgId !== undefined) this.liveMessageDbIds.push(msgId)
      onEvent({ ...event, message: stripped })                    // ② WS 转发剥离版（base64 不上线路）
      return
    }
    const msgId = agentStore?.sessions.appendMessage(this.sessionId, event.message)
    if (msgId !== undefined) this.liveMessageDbIds.push(msgId)
  }
  onEvent(event)
})

await this.agent.prompt(userMessage)                              // 本轮 LLM 看到真实图片

// ③ 轮后改写内存：pi-agent-core 已把完整 user 消息 push 进 state，这里用剥离版替换
if (fullUserMsg && attachments.length > 0) {
  const stripped = stripUserAttachments(fullUserMsg, attachments)
  this.agent.state.messages = this.agent.state.messages.map(m => m === fullUserMsg ? stripped : m)
}
await this.maybeCompact()
```

- ① DB：剥离版，无 base64。
- ② WS 转发：剥离版，base64 不上线路；客户端 reducer 合并时与乐观消息（path-only）一致。
- ③ 轮后内存：通过 `state.messages` setter 重新赋值（setter 内部 `.slice()`，见 `agent.js:42-44`），把完整 user 消息对象替换为剥离版。下一轮 LLM 调用上下文自动是便宜文本。
- `attachments` 作为 `sendMessage` 入参，在监听器闭包中引用。

### 4. convertToLlm 防护层

`LiveSession.buildAgent`（`live-session.ts:312-386`）注入自定义 `convertToLlm`（AgentLoopConfig），作为 defense-in-depth：

```ts
convertToLlm(messages) {
  return messages
    .map(m => {
      if (m.role === "user") {
        const { _attachments, ...rest } = m as any          // 剥离 _attachments
        // 兜底：丢弃任何 data 为空的 image 块（理论上不会出现）
        if (Array.isArray(rest.content)) {
          rest.content = rest.content.filter(c => !(c.type === "image" && !c.data))
        }
        return rest
      }
      return m
    })
    .filter(m => m.role === "user" || m.role === "assistant" || m.role === "toolResult")
}
```

- 剥离 `_attachments` 非标准字段（不依赖 provider 对未知字段的宽容）。
- 不影响「本轮刚发的带图消息」——该消息此刻在内存里仍是完整版（轮后才改写），convertToLlm 原样放行真实 ImageContent。

### 5. WS 契约扩展（通用 attachments）

`packages/server/src/contracts/websocket.ts` 的 `chatClientMessage`：

```ts
Type.Object({
  type: Type.Literal("message"),
  content: Type.String(),
  attachments: Type.Optional(Type.Array(Type.Object({
    type: Type.String(),
    path: Type.String(),
    mimeType: Type.String(),
    // 可选 meta（如 image 的 width/height）允许额外字段，不严格校验
  }))),
})
```

- 可选字段，老客户端不传 → 完全向后兼容。
- `parseChatClientMessage` 自动获得运行时校验。

### 6. 链路签名调整（透传 attachments）

| 层 | 旧签名 | 新签名 |
|---|---|---|
| `ChatSessionHub` attachment | `sendMessage(content: string)` | `sendMessage(content: string, attachments?: Attachment[])` |
| `ChatSessionHub.startRun` | `(content)` | `(content, attachments?)` |
| `SessionManager.sendMessage` | `(sessionId, message, onEvent)` | `(sessionId, message, attachments?, onEvent)` |
| `LiveSession.sendMessage` | `(message, onEvent)` | `(message, attachments?, onEvent)` |

业务参数走函数签名；client/projectId 等环境依赖仍走 Context（不变）。

### 7. 上传路由（通用附件）

新增 `packages/server/src/routes/attachments.ts`：

```
POST /api/projects/:projectId/attachments
  multipart field "file"（通用字段名；attachment type 由 mimeType 判定，本期仅 image/*）
  → 校验 mimeType ∈ {image/png, image/jpeg, image/webp}（本期仅图片）
  → 大小上限 ≤ 5MB（前端已压，后端兜底）
  → 文件名 {timestamp}-{randomHex8}.{ext}
  → 写入 <projectRoot>/.spherse/attachments/   (新目录，与 generated-images 平级)
  → assertInsideProject 校验最终路径（防穿越）
  → 用 FileWriteMutex 写入（并发安全）
  → 返回 { type:"image", path:".spherse/attachments/xxx.png", previewUrl, width, height, bytes }

DELETE /api/projects/:projectId/attachments
  body { path }
  → assertInsideProject + 必须在 .spherse/attachments/ 下
  → 删除文件（前端取消附件时清理，避免孤儿）
```

- preview URL 复用现有 `generate_image` 的 `getPreviewUrl(path)` 机制（前端 `client.getPreviewUrl`）。

### 8. 前端：压缩

新增 `packages/app/src/features/chat/utils/compress-image.ts`（纯浏览器 Canvas，零依赖）：

```
pickFile (accept="image/*")
  → createImageBitmap(file)
  → 若 long edge > MAX_EDGE(1568)：canvas 等比缩小
  → canvas.toBlob("image/jpeg", QUALITY=0.82)
  → 若 bytes > MAX_BYTES(~1MB)：降 quality 再压（循环到达标或 q=0.5 底线）
  → 返回 { blob, width, height, mimeType:"image/jpeg" }
```

- 阈值依据：OpenAI/Anthropic vision 推荐 long edge ≤ 1568；多数 provider 计费/限速与像素相关。
- 统一转 JPEG（截图/照片体积最优；vision 对透明度不敏感）。

### 9. 前端：Composer UI

`packages/app/src/features/chat/Composer.tsx`（超 ~150 行则拆 `AttachmentBar` 子组件）：

- 新增附件按钮（`Paperclip` 图标）+ 隐藏 `<input type="file" accept="image/*">`。
- 组件内 `useState<AttachedImage | null>` 持有待发送图片（短生命周期 UI 状态，不进全局 store，符合 store 规范）。
- 状态机：`idle` → `compressing`（转圈）→ `uploading`（转圈）→ `ready`（缩略图 + × 删除）/ `error`（toast）。
- 已附图：textarea 上方渲染缩略图条；× 删除调 `DELETE /attachments` 清理已上传文件。
- `onSend` 签名：`(message: string, image?: AttachedImage) => void`；发送后清空 image state。
- `compressing/uploading` 时禁用发送按钮。

### 10. 前端：模型能力 gating

- 新增 hook（如 `useSessionModelCapability`，或在 chat session hook 内 expose）解析当前 agent 的 model id → 查 catalog 得 `input: ("text"|"image")[]`。
- 不含 `image`：**附件按钮禁用 + tooltip「当前模型不支持图片」**；已选图也阻止发送并 toast。
- 需要把 catalog 的 `input` 能力数据在 chat 上下文可达（目前 UI 从不读该字段）。

### 11. 前端：ChatMessage 类型与历史展示

`packages/app/src/features/chat/types.ts` 的 `ChatMessage` 增可选字段：

```ts
_attachments?: Array<{ type: "image"; path: string; mimeType: string; width?: number; height?: number }>
```

- 乐观消息与服务端确认消息都带该字段 → 展示一致；reducer 合并不丢失。
- `MessageItem` 对 user 消息：读 `chatMessage._attachments`，在文字下方渲染缩略图（`<img src={client.getPreviewUrl(path)}>`），可点击放大用 `createPortal(..., document.body)` 全屏 viewer（避开宿主 `backdrop-filter`/`transform` 创建 containing block 的问题，符合浮层规范）。

## 端到端数据流

```
[选图] → Canvas 压缩 → POST /api/projects/:id/attachments → server 写 .spherse/attachments/{ts}-{hash}.png
   → 返回 { path, previewUrl, width, height }
[Composer 展示缩略图]
[发送] → onSend(text, image) → streaming-store 乐观插入 user 消息(带 _attachments)
   → WS { type:"message", content:text, attachments:[{type:"image", path, mimeType}] }
   ─── server ───
   → ws-chat parseChatClientMessage → ChatSessionHub.startRun(text, attachments)
   → SessionManager.sendMessage(sessionId, text, attachments, cb)
   → LiveSession.sendMessage:
       image processor.preprocess(path→base64) → 构建 UserMessage(text + ImageContent)
       → agent.prompt(userMessage)        ← 本轮 LLM 看到真实图片
       → message_end(user) → 落【剥离版】(content 文本占位 + _attachments:path)
       → 助手回复 message_end(assistant) → 正常落库
       → 轮后改写内存 user 消息为剥离版
   ─── 后续轮次：上下文自动是便宜文本版 ───
[UI 展示] → projection 读 _attachments.path → previewUrl 渲染缩略图（磁盘读取，始终可见）
```

## 测试

### Core（`packages/core`，必须有单元测试）

新增 `packages/core/src/__tests__/attachments/image-attachment-processor.test.ts`：

- `preprocess`：mock 文件读取 → 返回正确 `ImageContent`（base64 + mimeType）；路径越界（不在 `.spherse/attachments/`）抛错。
- `placeholder`：返回固定占位文本。
- 未注册的 attachment type → `attachmentProcessors[type]` 为 undefined（LiveSession 抛错）。

新增 `packages/core/src/__tests__/session/live-session-attachments.test.ts`（或扩展现有 live-session 测试）：

- `sendMessage` 带 image attachment：`agent.prompt` 收到的 UserMessage `content` 含真实 `ImageContent`（mock agent）。
- 落库的 user 消息是**剥离版**（无 base64，content 全文本，`_attachments` 含 path）。
- 轮后 `agent.state.messages` 末尾 user 消息被改写为剥离版。
- `convertToLlm`：剥离 `_attachments`；丢弃空 data 的 image 块；保留本轮完整 image 块。

更新 `packages/core/src/__tests__/store/session.test.ts`（如存在）：确认带 `_attachments` 的 message 能正确序列化/反序列化。

### Server（`packages/server`）

新增 `packages/server/src/routes/attachments.test.ts`（contract/route 测试）：

- `POST /attachments`：合法图片 → 200 + `{path, previewUrl, ...}`；非图片 mimeType → 4xx；超 5MB → 4xx；路径穿越尝试 → 拒绝。
- `DELETE /attachments`：删除已上传文件；越界路径 → 拒绝。

更新 WS contract 测试：`parseChatClientMessage` 接受带 `attachments` 的 message；拒绝畸形 payload。

### App（`packages/app`）

- `compress-image` 工具：mock Canvas，断言长边 ≤ 1568、输出 JPEG、体积达标。
- Composer：附件按钮交互、状态机、gating（模型不支持 vision 时禁用）。
- MessageItem：`_attachments` 渲染缩略图。

## 文档同步（AGENTS.md 要求）

- `docs/official/project-structure.md`：`core/src/` 加 `attachments/` 目录条目；`server/src/routes/` 加 `attachments.ts`。
- `docs/dev/backlog.md`：新增条目并标记完成。
- 检查 `docs/official/` 是否有消息格式 / chat 协议文档需补 `_attachments` 约定。

## 已知边界与风险

- **compaction 交互**：compaction 只读 `content` 文本生成摘要并改写**内存** `agent.state.messages`；DB 原始行不变 → UI 历史分页读 DB，不受 compaction 影响，旧图依然可显示。LLM 上下文里超老的图会被摘要吞掉（符合 compaction 本意）。
- **`_attachments` 非标准字段**：下划线前缀表示 Spherse 自有约定；convertToLlm 统一剥离，不依赖 provider 宽容。
- **pi-agent-core 自管 state**：`message_end` 时 runtime 自己把消息 push 进 `_state.messages`（`agent.js:370`）；带图 user 消息完整版会进内存，必须靠轮后 setter 重赋值替换为剥离版（见 §3 ③）。
- **附件磁盘无 GC**：删除消息/会话不会清理 `.spherse/attachments/` 下文件；体积由前端压缩兜底，GC 留作后续。
- **透明度丢失**：统一转 JPEG，PNG 透明通道会丢失（vision 场景可接受；如后续需要再加 PNG 选项）。
- **模型能力数据可达性**：当前 UI 从不读 `Model.input`，需把该字段在 chat 上下文（catalog/session）暴露给 Composer gating。
