# ADR-0008：chat turn 失败不做前端自动重试，仅手动重试

- 状态：accepted
- 日期：2026-08-28
- 影响：`packages/app` chat 域（`retry-plan.ts`、`streaming-store.ts`）；server `retryLastTurn` 契约保留、仅由手动触发

## 背景

2026-08-08 的 chat 韧性设计引入前端自动重试（TRANSIENT 错误 + 2 次 backoff）。三处叠加缺陷使其不可靠：水化的历史 error 与 live error 无法区分（分类 fallback 为 TRANSIENT）、触发与事件内容无关（attach 补发的 `run_status` 即可命中）、重试预算是纯前端状态（重开会话归零）——打开一个末尾 turn 为 error 的会话就会自动重放数小时前的失败 turn。

## 决策

- 前端对失败的 agent turn **不做任何自动重试**：错误一律落错误气泡，由用户经手动按钮触发 retry-last / resend
- 更根本的理由：agent turn 非幂等（副作用工具会重复执行）且 token 代价高，「是否值得重试」需要用户语境，错误串 regex 分类无法可靠承担；触发与预算的正确性依赖客户端会话生命周期状态，该状态本质不可靠（重开 / 多端 / TTL 清理）

## 后果

- 正：整类误重放 bug 消除，删除约 170 行机制代码；重试语义单一（用户意图驱动）
- 负：限流、网络抖动等瞬时错误需手动点一次重试；TRANSIENT 误分类残余风险降级为仅影响错误展示（见 backlog 对应条目）

## 原始记录

- `docs/dev/bugfix/2026-08-28-chat-auto-retry-removal/design.md`（本次分析与修复）
- `docs/dev/features/2026-08-08-chat-resilience-retry/design.md`（被本次推翻的原始自动重试设计）
