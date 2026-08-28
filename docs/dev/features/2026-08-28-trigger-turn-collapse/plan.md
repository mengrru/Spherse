# Trigger 对话轮折叠实施计划

设计：`design.md`。按依赖顺序 core → server → app，测试随实现补。

## core

- [x] `session/events.ts`：`"user/message"` data 加 `source?: "triggered"; triggerName?: string`
- [x] `session/agent-runner.ts`：`sendMessage` 加第 4 参 `meta?: SendMessageMeta`，appendBatch 按存在性写入
- [x] `session/session-manager.ts`：透传 meta
- [x] `kernel/ports.ts` `SessionPort.sendMessage` + `factory.ts` 装配：透传 meta
- [x] `trigger/executor.ts`：`fire` 传 `{ source: "triggered", triggerName }`
- [x] `session/fold.ts`：`DerivedMessageEntry` + `deriveHistoryEntries` / `deriveMessageEntries` 带出字段
- [x] `project-manager.ts`：`getRecentSessionHistory` entries 投影加字段
- [x] 测试：fold 带出 / withdrawn 排除 / AgentRunner 写入 / executor → event log（不 mock 被测方法）

## server

- [x] `contracts/sessions.ts`：`sessionMessagesPageResponse.entries[]` 加 `source` / `triggerName`（Optional）
- [x] 契约测试 round-trip

## app

- [x] `features/chat/types.ts`：`ChatMessage` 加 `_triggered?: true` / `_triggerName?: string`
- [x] `features/chat/model/chat-history.ts`：归一化保留字段，user 分支写入
- [x] 新增 `features/chat/model/turn-groups.ts`：分组派生（items 携带原始 index、hasError）+ 单测
- [x] `MessageList.tsx`：组级 reverse + trigger 组 Collapsible + 摘要条（chevron / 文案 / 错误徽标 / `data-chat-turn-collapse`）
- [x] i18n：`chat.triggerTurnSummary` / `chat.triggerTurnSummaryFallback` / `chat.triggerTurnErrorBadge`
- [x] theming：`agent-theme-template.css` + 两个 theme skill 同步钩子
- [x] structure test：摘要条钩子守卫；`parseHistoryMessages` 透传测试；跨页合并测试

## 收尾

- [x] lint + build + typecheck + 相关单测
- [x] doc-sync 清单（见 design.md 末节）
