# Chat WebSocket 生命周期修复

## 问题

长响应或连接持续较久时，renderer 可能因心跳误判主动关闭 Chat WebSocket。旧链路把 socket close 同时解释为 run 结束和 LiveSession 销毁，导致：

- 前端立即清除 streaming/loading；
- server 后续事件仍写向旧 socket，重连无法接管；
- 重连因 `historyLoaded` 已为 true 不再拉取历史；
- socket send 抛错发生在消息持久化之前时，最终回复也可能没有写入数据库。

## 生命周期模型

系统拆分为三层：

1. Core 的 `LiveSession` 只负责 agent 执行、上下文与消息持久化，继续使用单次 `sendMessage` callback 输出事件。
2. Server 的 `ChatSessionHub` 按 project/session 管理 transport channel，负责共享 restore、当前 run 状态、事件广播、压缩快照和空闲释放。
3. Chat WebSocket 是 channel 的可替换 attachment，close 只解除 attachment，不等于 abort 或 run 结束。

运行期间没有 attachment 时，Core run 继续执行。新的 socket attach 时由 `ChatSessionHub` 重放当前 run 的压缩事件快照，并发送 `run_status`，从而区分「仍在执行」和「断线期间已经结束」。run 完成且没有 attachment 后，hub 销毁对应 LiveSession；连接生命周期能力不进入 Core session 内部。

## 历史对账

`historyLoaded: boolean` 被替换为 `historyStatus: pending | syncing | ready`。它不再表达「该 session 曾经加载过历史」，而只表达当前连接的最新页对账阶段。

每次连接成功都拉取最新 10 turn。分页 contract 返回带稳定数据库 id 的 `entries: [{ id, message }]`，前端按 id 幂等合并；连接期间到达的 WebSocket 事件先暂存，历史返回后再顺序归约，因此不会被较旧的 HTTP 响应覆盖。

前端实现按职责拆分：

- `features/chat/runtime/streaming-store.ts` 仅保存 UI 可观察状态并暴露 actions；
- `features/chat/runtime/chat-session-runtime.ts` 持有单个 session 的 WebSocket、心跳、重连、连接期事件缓冲和历史对账；
- `features/chat/model/chat-session-reducer.ts` 只归约实时事件；
- `features/chat/model/chat-history.ts` 负责持久化历史投影与稳定 id 合并；
- `features/chat/model/chat-tool-projection.ts` 为实时与历史链路共享 tool/card 投影。

WebSocket 不进入 Zustand。连接状态使用 `connectionStatus: disconnected | connecting | open`，与 `historyStatus` 分开表达，因为 socket 已连接但历史仍在同步、socket 已断开但已有历史仍可展示，都是合法组合。

## 心跳

心跳记录正在等待的 ping，而不是仅比较上次 pong 的绝对时间。若 renderer suspend 导致定时器跳跃超过 timeout，恢复后的第一次 tick 重置探测窗口，不会刚发送新 ping 就关闭连接。

## 持久化与错误隔离

`message_end` 在 Core 内先写入 SessionStore，再调用事件 callback。Server hub 对每个 attachment 的发送单独捕获错误，关闭或异常的 socket 不会中断 agent 运行，也不会阻止最终消息持久化。
