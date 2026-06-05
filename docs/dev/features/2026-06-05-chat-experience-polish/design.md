# Chat 体验优化

日期：2026-06-05

## 背景

当前 Chat 界面存在若干体验缺陷：
- 用户在输入框中编写内容后切换 session 或关闭应用，输入内容丢失
- 消息无法复制，用户需要手动选择文本
- 对话为空时界面完全空白，缺少引导
- 流式输出期间用户浏览历史消息时被强制拉回底部
- 发送消息后输入框失焦

## 需求范围

5 个子项，全部为纯前端改动，不涉及 server/core 层。

---

## 1. Composer 输入缓存

### 行为

- 用户在输入框输入内容时，自动缓存到 localStorage
- 切换 session 后切回，恢复之前的输入内容
- 应用关闭后重新打开，恢复之前的输入内容
- 成功发送消息后，清除对应 session 的缓存

### 存储

- localStorage key 格式：`spherse:draft:{sessionId}`
- value：输入框的原始文本（string）

### 实现

在 `Composer.tsx` 中：

1. 初始化时从 localStorage 读取 draft：`localStorage.getItem(key)`，作为 `useState` 的初始值
2. 用 `useEffect` 监听 `input` 变化，debounce 300ms 后写入 localStorage
3. `send()` 成功后调用 `localStorage.removeItem(key)`
4. 需要从 `Chat` 组件传入 `sessionId` prop

### 边界情况

- 空字符串不写入 localStorage（避免存储无意义的空值）
- 发送后清除缓存，而非设为空字符串
- 组件卸载前（`useEffect` cleanup）立即写入当前值，避免最后一次 debounce 丢失

---

## 2. 消息复制按钮

### 行为

- 鼠标悬停在消息气泡上时，显示复制按钮
- AI 消息：按钮在气泡外侧右边，与气泡底部并排对齐
- 用户消息：按钮在气泡外侧左边，与气泡底部并排对齐
- 点击后复制消息的原始 Markdown 内容（`message.content`）到剪贴板
- 复制成功后按钮图标从 `Copy` 切换为 `Check`，持续 2 秒后恢复

### 实现

在 `MessageItem.tsx` 中：

1. 提取 `CopyButton.tsx`，封装复制状态、剪贴板调用和成功反馈
2. `MessageItem` 外层使用 `group` + flex wrapper，气泡和复制按钮作为并排子元素
3. AI 消息：正常 flex 顺序，复制按钮位于气泡右侧
4. 用户消息：`flex-row-reverse`，复制按钮位于气泡左侧
5. 按钮默认 `opacity-0 group-hover:opacity-100 transition-opacity`
6. 使用 `navigator.clipboard.writeText(message.content)` 复制，复制失败时吞掉错误避免 unhandled rejection
7. 用 `useState` 管理 copied 状态，`setTimeout(2000)` 恢复

### 样式

- 按钮尺寸：`icon-sm`
- 按钮 variant：`ghost`
- 图标：`CopyIcon` / `CheckIcon`（from lucide-react）
- 避免在流式输出中显示（`message._streaming` 时不显示 copy 按钮）

---

## 3. 空状态引导

### 行为

- 当 `messages.length === 0` 时，在消息列表区域居中展示引导内容
- 引导内容包含：agent 图标/名称 + 提示文字
- 用户发送第一条消息后，引导内容消失

### 实现

在 `MessageList.tsx` 中：

1. 当 `messages.length === 0` 时，渲染居中的引导区域替代消息列表
2. 引导内容：agent 名称 + "发送一条消息开始对话" 提示文字
3. 需要 `MessageList` 接收 `agent` prop（已有）

### 样式

- 居中布局：`flex items-center justify-center flex-1`
- agent 名称：使用 `text-muted-foreground text-sm font-medium`
- 提示文字：使用 `text-muted-foreground text-sm`

---

## 4. 智能滚动锁定

### 行为

- 正常情况下，新消息到达时自动平滑滚动到底部（现有行为）
- 当用户向上滚动浏览历史消息时（距底部 > 100px），暂停自动滚动
- 用户滚动回底部附近（距底部 ≤ 100px）时，恢复自动滚动
- 滚动锁定期间，底部显示一个"回到底部"浮动按钮，点击后平滑滚回底部

### 实现

改造 `useChatScroll.ts`：

1. 新增 `isAtBottom` state，初始为 `true`
2. 返回 scroll container 的 ref（当前只返回 `messagesEndRef`，需要新增一个 `containerRef`）
3. 在 `containerRef` 上监听 `scroll` 事件，计算 `container.scrollHeight - container.scrollTop - container.clientHeight <= 100` 判断是否在底部
4. `useEffect` 中只有 `isAtBottom` 为 `true` 时才触发 `scrollIntoView`
5. 返回 `isAtBottom` 和 `scrollToBottom` 方法供外部使用

改造 `MessageList.tsx`：

1. 使用外层 `relative flex-1 min-h-0` wrapper 包裹滚动容器，`containerRef` 绑定到内部滚动 div
2. "回到底部"按钮作为 overlay 放在滚动容器外层，避免参与滚动内容高度
3. 当 `!isAtBottom` 时，渲染"回到底部"浮动按钮
4. 按钮位置：`absolute bottom-4 right-4`

### "回到底部"按钮样式

- 圆形按钮，带阴影：`rounded-full shadow-md`
- 使用 `ChevronDownIcon`（from lucide-react）
- 尺寸：`icon-lg`
- variant：`outline`，并显式添加 `bg-background` 避免透明背景

---

## 5. 发送后自动聚焦

### 行为

- 用户发送消息后，textarea 自动重新获得焦点
- 用户可以立即继续输入下一条消息，无需手动点击

### 实现

在 `Composer.tsx` 中监听 `streaming` 状态；发送后 textarea 会在 streaming 期间禁用，因此在 `streaming` 变回 `false` 时调用 `textareaRef.current?.focus()`。

---

## 涉及文件

| 文件 | 改动类型 |
|------|----------|
| `packages/app/src/features/chat/Composer.tsx` | 修改 — 输入缓存 + 自动聚焦 |
| `packages/app/src/features/chat/MessageItem.tsx` | 修改 — 添加复制按钮 |
| `packages/app/src/features/chat/MessageList.tsx` | 修改 — 空状态引导 + 滚动容器 ref + 回到底部按钮 |
| `packages/app/src/features/chat/hooks/useChatScroll.ts` | 修改 — 智能滚动锁定 |
| `packages/app/src/features/chat/index.tsx` | 修改 — 传递 sessionId prop + 传递新的 ref 和状态 |

## 不涉及

- 不涉及 server/core 层改动
- 不引入新的全局 store
- 不引入新的依赖包
