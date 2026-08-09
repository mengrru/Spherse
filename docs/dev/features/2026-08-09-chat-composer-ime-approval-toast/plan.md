# 实施计划

## 任务拆分

### T1. Composer IME 回车守卫 + 字号（`packages/app/src/features/chat/Composer.tsx`）

- 新增 `composingRef = useRef(false)`。
- `<Textarea>` 绑定 `onCompositionStart` / `onCompositionEnd` 翻转 ref。
- keydown 守卫追加 `&& !event.nativeEvent.isComposing && !composingRef.current`。
- 字号：`text-sm leading-5` → `text-base leading-6`。
- 同步 `LINE_HEIGHT 20 → 24`（MIN/MID/MAX 随之）。

### T2. ApprovalNoticeBridge（`packages/app/src/features/chat/ApprovalNoticeBridge.tsx` 新增）

- `collectPendingApprovals(sessions)`：扫 `_card.requestId` 真值的 tool call。
- `notifiedRef: Set<string>`；`activeRef`（来自 `useMatch`）。
- 主 effect 订阅 `useStreamingStore.subscribe(checkAndNotify)`；路由 effect 在 `activeSessionId` 变化时重扫。
- toast.success + action navigate `/project/:projectId/chat/:sessionId`。
- 返回 null。

### T3. 挂载（`packages/app/src/App.tsx`）

- import 并在 `<Toaster />` 旁渲染 `<ApprovalNoticeBridge />`。

### T4. i18n（`packages/i18n/src/locales/{zh-CN,zh-TW,en}.ts`）

- `chat.approvalToastMessage` / `chat.approvalToastAction`。

### T5. 验证

- `npm run lint`
- `npm test --workspace=packages/app`
