# ADR-0004：事件先持久化再广播（persist-before-callback）

- 状态：accepted
- 日期：2026-08-21（随事件日志定型）
- 影响：`packages/core/src/session/` EventPipeline、`packages/server/src/chat-session-hub.ts`、chat 重连路径

## 背景

流式韧性工作发现：如果广播（推送给 renderer）成功后才落库，连接故障会打断 agent 或丢消息；两类副作用（落库、广播）的顺序决定了崩溃窗口内数据是否可信。

## 决策

- `persistMiddleware` 先把事件写入 SessionEventLog，成功后才放行广播
- socket close 只解除 attachment：Core run 继续执行并持久化，重连后由 hub 补发压缩快照
- control 事件旁路（controlBus 直达 sink），不经中间件

## 后果

- 正：落库不依赖连接健康；重连重放只需 O(压缩后) 开销
- 负：广播侧必须配合快照压缩与去重；调试时要区分「已落库未广播」的中间态

## 原始记录

- `docs/dev/features/2026-08-21-session-event-log/`
- `docs/dev/features/2026-06-09-chat-streaming-resilience/`
