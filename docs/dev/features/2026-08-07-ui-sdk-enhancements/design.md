# UI SDK 体验优化：toast、card 去重折叠、openSession

> 日期：2026-08-07
> 范围：三项独立的 UI SDK / chat 渲染增强 —— ① HTML 可主动弹 toast；② 相同 `file_path` 的 HTML card 仅展开最近一张、较早的同路径卡片默认折叠不挂载 iframe；③ 新增 `openSession` 用于只打开已有会话不发消息，并厘清 `sendMessage` 文档。

## 背景

当前 UI SDK 存在三个体验缺口：

1. **HTML 无法主动反馈**。宿主侧已有全局 `<Toaster />`（sonner），但 iframe 内的 HTML 没有任何动作能触发宿主 toast，只能靠改 DOM 自行模拟提示，体验割裂。
2. **同路径 card 重复堆叠**。Agent 反复 `render_card` 同一 `file_path`（如 dashboard.html）时，每张 card 都会挂载独立 iframe，造成大量重复 iframe 与性能浪费。`MessageItem.tsx:78-92` 按 `toolCallId` 渲染每张 card，无任何按 `file_path` 的去重。
3. **无法「只打开已有会话」**。`sendMessage` 在 `message` 缺失时直接 `return`、不导航（`send-message.ts:17`），因此无法只跳转不发消息；`createSession` 只能创建新会话；`floatSession` 是浮窗语义。AI 因此常误用 `sendMessage` 或不知如何只跳转。

## Feature 1 — toast 支持

### 用户 API

```js
spherse.toast({
  variant: "success",          // "default" | "success" | "error" | "warning" | "info"，默认 "default"
  message: "已保存",
  description: "world/game.html",  // 可选
});
```

- Fire-and-forget，复用宿主全局 `<Toaster />`（sonner），不返回值。
- `variant` 决定调用 `toast(...)` / `toast.success(...)` / `toast.error(...)` / `toast.warning(...)` / `toast.info(...)`。
- `message` 必填（非字符串则忽略）；`description` 可选，作为 sonner 第二参数。
- 受现有 UI SDK 速率限制（10/min）约束，与其它 action 一致。

### 改动点

- 新建 handler `packages/app/src/ui-sdk/handlers/show-toast.ts`：`registerAction("showToast", ...)`，校验 `message`，按 `variant` 分派 sonner `toast*`，`description` 透传。
- `packages/app/src/ui-sdk/index.ts` 注册 `import "./handlers/show-toast"`。
- `packages/sdk/src/runtime/actions.ts` 增加 `toast: (params) => fire("showToast", params)`。
- 重新构建 `@spherse/sdk` bundle（`packages/sdk/scripts/build.mjs`，产物 `dist/browser.js` + `dist/source.js`）。

### i18n

`message` / `description` 均由 HTML 自行提供，无需新增翻译 key。

## Feature 2 — 相同 file_path 的 HTML card 去重 + 折叠

### 语义

- 仅对 `card.type === "html"` 且存在 `file_path` 的卡片生效；inline（无 `file_path`）的卡片不去重。
- 去重范围：**整个会话**（当前已加载的全部消息），同一 `file_path` 只「展开渲染」最近一张（按消息流顺序，最后出现者胜出）。
- 较早的同路径卡片默认折叠：**不挂载 iframe**，只显示占位条，点击可展开（懒挂载 iframe）。
- 用户手动展开某张被折叠的卡片后，该卡片保持展开（尊重用户意图），即使随后又到达同路径的新卡片也不会被强制收回起。

### 计算位置

在 `MessageList.tsx` 用 `useMemo` 扫描传入的 `messages: ChatMessage[]`：

1. 遍历每条消息的 `_toolCalls`，收集所有 `card.type === "html" && card.file_path` 的 `(filePath, toolCallId)`，保留每个 `filePath` 最后出现的 `toolCallId` 为「最新」。
2. 派生 `supersededToolCallIds: Set<string>`：除最新外、其余同路径 html 卡片的 `toolCallId`。
3. 下传给 `MessageItem`，再传到 `HtmlCardRenderer` 的 `defaultCollapsed` prop。

去重是纯派生状态，不进 reducer / streaming-store，不持久化，重载后重算。

### HtmlCardRenderer 改动

- 新增 prop `defaultCollapsed?: boolean`。
- 本地 `const [collapsed, setCollapsed] = useState(defaultCollapsed)` + `userTouched` ref。
- 当卡片被更新的同路径卡片取代（`defaultCollapsed` 由 false 变 true）且用户尚未手动操作时，自动跟随折叠；一旦用户手动展开/折叠（置 `userTouched`），即锁定为用户选择，不再被新到达的同路径卡片影响。
- 折叠态：渲染占位条 —— 显示 `card.file_path`（项目相对路径）+ 展开按钮（chevron），**不挂载 iframe / img**；fetch effect 以 `!collapsed` 为门控，展开时才触发。
- 展开态：沿用现有渲染逻辑（file_path HTML → iframe / file_path 图片 → img / inline → iframe）。
- 样式仅用现有语义 token（`bg-muted` / `border-border` / `text-muted-foreground`），**不新增主题钩子属性**，无需同步主题 skill 文档。

### 不改动

reducer、streaming-store、server、core、持久化、chat-history 解析均不变。

### 边界

- 流式期间新 card 到达会让上一张同路径卡片变为折叠（其 iframe 卸载、新卡挂载）—— 符合「只展开最新」预期；已被用户手动展开的旧卡片保持展开。
- 分页加载更多消息时，`useMemo` 以全量 `messages` 重算，最新归属可能变化，表现自洽。

## Feature 3 — 新增 openSession + 厘清 sendMessage

### 用户 API

```js
spherse.openSession({ sessionId, float: true });   // fire-and-forget，仅打开已有会话，不发消息
spherse.sendMessage({ sessionId, message, float }); // request-response，发消息 + 打开
```

- `openSession`：fire-and-forget 导航动作，与 `openFile` / `openExternalLink` 同属导航族。校验 `sessionId` 存在（不存在则宿主 `toast.error`，复用现有 `ui-sdk.sessionNotFound` 文案），随后调用 `openChat(ctx, sessionId, float)`。`float` 为 `true` 时走浮窗（desktop），否则主面板导航。
- `openSession` 参数支持传字符串或对象：`asSession(value)` 复用现有规约（字符串 → `{ sessionId }`）。
- `sendMessage`：**保持只发消息**，handler 不变。

### 改动点

- 新建 handler `packages/app/src/ui-sdk/handlers/open-session.ts`：结构参考 `float-session.ts`，但 `openChat` 的 `float` 来自参数（而非恒为 `true`）。session 不存在时与 `float-session` 一致：`toast.error(translate(locale, "ui-sdk.sessionNotFound"))` + `respond(ctx, false, { error: "session_not_found" })` + return（`fire` 不带 requestId，`respond` 无 pending `call` 可 resolve，仅为对称保留）。
- `packages/app/src/ui-sdk/index.ts` 注册 `import "./handlers/open-session"`。
- `packages/sdk/src/runtime/actions.ts` 增加 `openSession: (value) => fire("openSession", asSession(value))`。
- 重新构建 `@spherse/sdk` bundle。

### skill 文档

- `packages/presets/skills/use-ui-sdk/SKILL.md`：
  - 「触发型 Action」新增 `spherse.openSession(params)` 小节（参数表：`sessionId` 必填、`float` 可选）。
  - `sendMessage` 小节补一句：「仅用于发送消息；如需只打开已有会话请用 `openSession`」。
  - 顶部 API 总表补充 `toast`、`openSession` 两行。
- `packages/presets/skills/write-html/SKILL.md`：快查表补充「只打开已有会话 → `openSession`」「弹提示 → `toast`」场景。

## 涉及文件清单

| Feature | 文件 |
|---|---|
| 1 toast | `packages/app/src/ui-sdk/handlers/show-toast.ts`（新）、`packages/app/src/ui-sdk/index.ts`、`packages/sdk/src/runtime/actions.ts`、SDK bundle 重建 |
| 2 card 去重 | `packages/app/src/features/chat/MessageList.tsx`、`packages/app/src/features/chat/MessageItem.tsx`、`packages/app/src/features/chat/HtmlCard.tsx` |
| 3 openSession | `packages/app/src/ui-sdk/handlers/open-session.ts`（新）、`packages/app/src/ui-sdk/index.ts`、`packages/sdk/src/runtime/actions.ts`、SDK bundle 重建 |
| 文档 | `packages/presets/skills/use-ui-sdk/SKILL.md`、`packages/presets/skills/write-html/SKILL.md` |

## 验证

- **toast**：SDK bridge E2E（`packages/desktop/e2e/ui-sdk-bridge.spec.ts` 风格）新增用例：iframe 内 `spherse.toast({ variant, message, description })` 触发对应 sonner toast 出现；缺 `message` 时静默不弹。
- **card 去重折叠**：单元测试覆盖 `MessageList` 派生的 `supersededToolCallIds` 计算（多消息、同/异路径、inline 不参与）；`HtmlCardRenderer` 折叠态不挂载 iframe、展开后挂载。可选 E2E：同路径连续 `render_card` 后只一个 iframe 存在，旧卡片占位条可展开。
- **openSession**：UI SDK action E2E（`ui-sdk.spec.ts` 风格）新增用例：`spherse.openSession({ sessionId })` 导航到目标会话且不发消息；未知 sessionId 触发 `sessionNotFound` toast。
- `npm run verify`（lint + build + 单测 + i18n check）；SDK bundle 改动后确认 `packages/sdk/dist` 重新生成。
