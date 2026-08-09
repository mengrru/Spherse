# Chat Composer 修复与优化

日期：2026-08-09

本 feature 包含三处独立但相关的小改动，集中在 chat composer 与会话反馈提醒体验：

1. **IME 输入法回车误发送修复**——中文输入法下用回车确认候选词/上屏英文时，不再误触发发送。
2. **Agent 等待确认 toast 提醒**——会话中的 agent 停在需要用户批准（approval gate）的位置时，弹 toast，点击按钮跳转到对应 session。
3. **Composer 字号调大**——对话框正文字号从 `text-sm`(14px) 提升到 `text-base`(16px)。

---

## 1. IME 回车误发送修复

### 背景

在 macOS 上使用中文输入法时，用户在候选词面板（input selection panel）仍显示时按回车，意图是上屏当前输入的英文/原文字。但 `Composer` 的 keydown 处理对裸 Enter 无条件触发 `send()`，导致未完成的内容被直接发送。

当前实现（`packages/app/src/features/chat/Composer.tsx:151-156`）：

```tsx
onKeyDown={(event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    send();
  }
}}
```

全仓库无任何 `compositionstart`/`compositionend`/`isComposing` 处理。

### 方案

采用「`isComposing` + ref 双保险」的稳健方案：

- 在 `Composer` 中新增 `const composingRef = useRef(false)`。
- `<Textarea>` 上绑定：
  - `onCompositionStart={() => { composingRef.current = true; }}`
  - `onCompositionEnd={() => { composingRef.current = false; }}`
- keydown 守卫改为：
  ```tsx
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing &&
    !composingRef.current
  ) { ... }
  ```

### 为什么需要双重判断

- `event.nativeEvent.isComposing`：规范路径，提交候选词的那次 Enter 在大多数浏览器上 `isComposing === true`。
- `composingRef`：兜底。WebKit/Safari 等存在已知 bug——上屏 Enter 的 keydown 可能先于 `compositionend` 触发且此时 `isComposing` 已为 `false`，但 ref 仍是 `true`，可正确拦截。

`Send` 按钮的 `onClick`（`Composer.tsx:194`）不受 IME 影响，无需改动。

### 影响范围

仅 `packages/app/src/features/chat/Composer.tsx` 一个文件。`Composer.structure.test.ts` 当前不断言 Enter 行为，无需更新测试。该 Composer 同时被主聊天页（`features/chat/index.tsx`）与悬浮窗（`features/floating-chat/FloatingChatContainer.tsx`）复用，一处修复覆盖两处。

---

## 2. Agent 等待确认 toast 提醒

### 目标

当会话中的 agent 执行停在需要用户给反馈处（approval gate：`run_command` / `manage_agent` / `manage_trigger` 等工具等待批准）时，弹 toast 提醒；用户点 toast 上的按钮直接跳转到对应 session。

### 关键事实（探索结论）

- **暂停信号**：`control_request`（`kind: "approval"`）事件。在 reducer（`chat-session-reducer.ts:171-193`）中体现为对应 tool call 的 `_card.requestId` 被设为非空；`control_resolved` 时清为 `undefined`（`chat-session-reducer.ts:195-221`）。因此 **「该 tool call 处于待批准」⟺ `_card.requestId` 为真值**。
- **背景会话仍能收到事件**：`streaming-store` 是模块级单例，会话 WS 在用户导航离开后不会被立即关闭——`useChatSession` 卸载时只 `detach`（减引用计数），而 `cleanupExpired` 仅在 `!streaming && attachedCount===0 && 超过 5min TTL` 时才 `disconnect`。运行中（含卡在 approval）的会话 `streaming` 恒为 true，WS 保持打开，事件持续 reduce 进 `sessions[id]`。
- **结论**：渲染层观察 `streaming-store` 即可覆盖「用户切到别的 session / 项目」这一主要场景，**无需改动 server / bus / contract**。
- **覆盖盲区**（本版本不处理）：纯服务端、无客户端 runtime 挂载的 trigger 会话卡在 approval 时不会被感知。属未来 bus 扩展项。
- **现成模板**：`features/agent-trigger/TriggerEventBridge.tsx:60-65` 已是 sonner `toast.success(msg, { action: { label, onClick: navigate } })` 的范本。

### 方案：全局观察者 `ApprovalNoticeBridge`

新增组件 `packages/app/src/features/chat/ApprovalNoticeBridge.tsx`，在 `App.tsx` 中与 `<Toaster />` 同级挂载（全局，路由树内，可用 `useNavigate` / `useMatch` / `useI18n`）。

#### 数据收集

```ts
function collectPendingApprovals(sessions): Array<{
  requestId: string;
  sessionId: string;
  projectId: string;
  toolName: string;
  command?: string; // run_command 时带上下文
}> {
  // 遍历每个 session 的 messages，找 _toolCalls 中 _card.requestId 真值的项
}
```

判定逻辑对齐 reducer：待批准 ⟺ `toolCall._card?.requestId` 真值（`type` 为 `"command"` 时 status 为 `pending_approval`；其它工具为 `type:"approval"`、status `pending`）。

#### 通知与去重

- `notifiedRef: Set<string>` 记录已 toast 过的 `requestId`（每个 approval 只提醒一次）。
- `activeSessionId`：来自 `useMatch("/project/:projectId/chat/:sessionId")?.params.sessionId`，存入 ref 供订阅闭包读取实时值。
- `checkAndNotify()`：遍历 pending 列表，对每个 item：
  - `requestId` 已在 `notifiedRef` → 跳过；
  - `sessionId === activeSessionId` → **跳过且不标记**（用户正在看该会话，内联 approve/decline UI 已足够，留作「离开后再提醒」）；
  - 否则：加入 `notifiedRef`，`toast.success(message, { action: { label, onClick: () => navigate(`/project/${projectId}/chat/${sessionId}`) } })`。

#### 触发时机

- 订阅 `useStreamingStore.subscribe(checkAndNotify)`：store 每次变更时扫描。
- 单独 `useEffect([activeSessionId])` 调用 `checkRef.current()`：路由变化时重新扫描——这样「正在看 A 时被抑制的 approval，切到 B 时」会触发提醒（因 A 的 requestId 当时未标记）。

#### 边界行为

- 在 A 中内联解决（`control_resolved`）→ requestId 从 pending 列表消失 → 永不提醒。✓
- 服务端 5 分钟 approval 超时自动拒绝 → 同样 resolve → 不产生残留 toast。✓
- 同一会话多个连续 approval：各自 requestId 独立去重。✓
- 已 toast（已标记）后用户回到该会话再离开：不重复 toast。✓（可接受，已提醒过）

#### i18n

新增 key（zh-CN 为基准，同步 zh-TW / en），位置与现有 `chat.*` 一致：

- `chat.approvalToastMessage`：基础语境「一个 Agent 正在等待你的确认」。zh-CN 注释需说明出现场景：某会话的 agent 工具调用等待用户批准时，且用户未停留在该会话。
- `chat.approvalToastAction`：按钮文案「前往会话」。

toast 类型用 `toast.success`（与 trigger 通知一致；语义为「需要你注意」，sonner 无更合适的语义档，沿用既有风格）。description 可选附 `toolName`（如 `run_command` 时给出命令），具体文案在 plan 阶段定稿。

### 影响范围

- 新增 `packages/app/src/features/chat/ApprovalNoticeBridge.tsx`。
- `packages/app/src/App.tsx`：挂载 `<ApprovalNoticeBridge />`。
- i18n：`packages/i18n/src/locales/{zh-CN,zh-TW,en}.ts` 新增 2 条 key。
- 不改动 server / contract / core。

### 为何不放在 `ProjectScope` / `TriggerEventBridge` 旁

- 该提醒需跨项目（用户可能在 A 项目的会话等待确认，却切到了 B 项目）。`ProjectScope` 只对当前项目挂载，无法跨项目感知。挂在 `App.tsx`（app shell，全局）读取全局 `streaming-store` 单例即可天然覆盖所有项目。

---

## 3. Composer 字号调大

`Composer.tsx` 的 `<Textarea>` 当前 `text-sm`（14px / 行高 20px）。正文与 placeholder 字号偏小。

### 方案

- 类名 `text-sm` → `text-base`（16px / 行高 24px）。
- 同步调整 auto-resize 常量，保持高度计算与实际行高一致：
  - `LINE_HEIGHT`: `20` → `24`
  - `MIN_HEIGHT` = `2 * LINE_HEIGHT + PADDING_Y` → `64`
  - `MID_HEIGHT` = `10 * LINE_HEIGHT + PADDING_Y` → `256`
  - `MAX_HEIGHT` = `20 * LINE_HEIGHT + PADDING_Y` → `496`
- `leading-5`（line-height: 20px）需同步改为 `leading-6`（24px）以匹配 `text-base`，避免行高与常量不符导致 auto-resize 抖动。

### 影响范围

仅 `packages/app/src/features/chat/Composer.tsx`。主聊天与悬浮窗共用，一并生效。

---

## 测试与验证

- **Task 1**：手动验证——macOS 中文输入法下输入英文候选词时按回车只上屏不发送；普通英文回车正常发送；Shift+Enter 换行正常。结构测试无需更新。
- **Task 2**：手动验证——
  - 在 session A 触发需批准的工具（如 `run_command`），A 中内联出现 approve UI，不弹 toast；
  - 切到 session B → 弹 toast → 点击「前往会话」跳回 A；
  - 在 A 中点批准/拒绝 → 无残留 toast；
  - 切换项目后仍能收到另一项目会话的提醒。
- **Task 3**：手动验证字号视觉变化，auto-resize 在 1/3/10+ 行各档位无抖动。
- **回归**：`npm run lint`；`npm test --workspace=packages/app`（含 Composer 结构测试）；建议跑 chat 相关 E2E（`npm run test:e2e --workspace=packages/desktop -- e2e/<chat 相关 spec>`）。

## 不在本次范围

- Trigger 会话（服务端无 runtime）卡 approval 的提醒——需扩展 bus 转发 `control_request`，留作后续。
- OS 级桌面通知（Electron `Notification`/dock badge）——当前无基建，不在本次。
