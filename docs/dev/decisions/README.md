# 决策记录（ADR）

编号短文档，记录统治架构的决策及其理由——「为什么这样做、当时否决了什么」。

## 规则

- 命名 `NNNN-slug.md`，编号递增不复用
- 骨架：状态 / 日期 / 影响 / 背景 / 决策 / 后果 / 原始记录（指向 `docs/dev/` 长文）
- **只追加不重写**：决策被推翻时只把状态改为 `superseded（由 ADR-NNNN 接替）`，原文不动
- **在决策发生时写**，10-20 行即可；不做全量历史补录——历史理由由 `docs/dev/` 设计文档承载，此处只索引承重决策
- `docs/official/` 在相应论断处链接「为什么见 ADR-NNNN」

## 索引

| ADR | 决策 | 状态 |
|---|---|---|
| [0001](0001-event-log-fold.md) | Session 数据采用 append-only 事件日志 + fold 投影 | accepted |
| [0002](0002-capability-kernel.md) | core 采用微内核 + Capability 贡献点模式 | accepted |
| [0003](0003-single-assembly-point.md) | 唯一装配点（组合根），运行期不做缝合 | accepted |
| [0004](0004-persist-before-callback.md) | 事件先持久化再广播（persist-before-callback） | accepted |
| [0005](0005-path-access-policy.md) | 路径访问权限集中为 category 白名单 | accepted |
| [0006](0006-host-bridge-shells.md) | 三壳共享 renderer，宿主差异经 HostBridge 抽象 | accepted |
| [0007](0007-contracts-in-code.md) | API 契约 schema 进代码（contracts + parseContract） | accepted |
| [0008](0008-no-frontend-auto-retry.md) | chat turn 失败不做前端自动重试，仅手动重试 | accepted |
