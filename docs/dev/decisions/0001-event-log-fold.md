# ADR-0001：Session 数据采用 append-only 事件日志 + fold 投影

- 状态：accepted
- 日期：2026-08-21
- 影响：`packages/core/src/session/`、`packages/core/src/store/session.ts`、chat 撤回 / 重试 / 压缩全链路

## 背景

原 `messages` / `compactions` 表是可变存储：撤回要删行、重试要改写、压缩要替换历史，崩溃恢复时「改到一半」的状态难以判定；每新增一个会话语义都要在表结构和迁移上开洞。

## 决策

- 消息唯一真相是 per-session 的 append-only `events` 表（主键 `(session_id, seq)`，seq 从 0 连续）
- 运行时消息数组只是 `deriveMessages` fold 投影缓存，可随时丢弃重建
- retry / withdraw / compaction 一律以重启点事件表达（`turn/retried` / `turn/withdrawn` / `compaction/applied`），不修改历史
- legacy 表保留只读、首次 restore 惰性迁移

## 后果

- 正：崩溃恢复幂等；新语义 additive、旧版本二进制正向兼容；会话分支有了锚点（parent_session_id / fork_seq）
- 负：读取需要投影、调试要读事件流而非消息表；单轮撤回被 digest 覆盖时必须拒绝（非破坏性剔除不可行）

## 原始记录

- `docs/dev/features/2026-08-21-session-event-log/`
