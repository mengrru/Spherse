# Core 微内核重构 Followup

- 日期：2026-08-20
- 前置：本目录 `design.md` / `plan.md` / `review.md`；P6 设计见 `docs/dev/features/2026-08-20-p6-server-alignment/`
- 状态：重构与 review 修复全部完成（PR #19）；本文汇总**尚未做、有明确触发条件**的后续事项

## 条件触发项（等第一个消费者立项）

### 1. run-state 下沉 core（触发：roundtable / 动态 tools 立项）

hub 的 `channel.running` 与 runner 的 `inFlight` boolean 合并为 core 单一 run-state 真相：

- server 409 与重连快照重放改为消费 core 派生（run-identity 下沉进 core）
- in-flight fail-fast 是安全不变量，保留；队列/优先级/来源区分等**调度语义**等 moderator 编排定义后再做——没有消费者的队列是投机设计
- 这是 roadmap 五 feature 中唯一需要跨 server/core 的结构改动

### 2. yolo 审批策略泛化（触发：第二个审批策略需求）

`profile.yolo ? undefined : approvalGate`（agent-assembly）泛化为 `approvalPolicy` 贡献点——白名单命令免审批、分级审批等。当前仅 boolean 一个消费者。

### 3. context/ 纯函数迁 kernel（触发：出现非 session 消费者）

`token-estimate` / `planCompaction` / `sanitizeToolCallPairs` 现住 `context/`，只被 session 域与 compaction capability 消费。当出现第三个消费者（如 memory 检索器直接用 token-estimate）时迁 kernel；现在搬是位置偏好游戏。

### 4. store→presets seed 注入（触发：下次动 store 初始化逻辑）

`store/project.ts` 仍硬 import `@spherse/presets`（设计缺陷 B7 未兑现 `open({ seed })`）。core 内 presets import 现收敛在 `presets.ts` + `store/project.ts` 两处。

### 5. store→mcp 的 normalizeMcpConfig 搬迁（触发：下次动 mcp-config）

`store/mcp-config.ts` import `../mcp/index.js` 的纯函数（缺陷 D3 半残留）。随手可搬，不值得单独 diff。

### 6. 跨层接缝契约对账（触发：下次批量动 SessionPort 或 PM 门面）

AGENTS.md 已立契约测试规矩；PM 门面 5 方法已覆盖（`write-facade-contract.test.ts`）。SessionPort 5 方法（create/restore/sendMessage/abortSession/sessionExists）在 server/desktop 包的契约覆盖缺口未逐条对账。

## Roadmap 落点备忘（评估结论，无需前置工作）

| Feature | 落点 | 需要的新东西 |
|---|---|---|
| 跨 session/agent memory | memory capability 扩展 | 存储半径（global scope 已有）/检索质量；架构零改动 |
| Agent 圆桌 | 新 roundtable capability + 编排层 | SessionPort 驱动 + 事件多路 merge（积木全在位）；配套做 #1 run-state |
| 动态 tool 注入 | 新 custom-tools capability | 用户 tool 声明→AgentTool 适配 + JS 执行沙箱（feature 自身设计题）；刷新信号已预铺（onAgentConfigChanged kind="tools"） |
| 会话分支 | store 加 branch_points 表 + compactor 加 fork 构造入口 | `AgentRunner.init({ initialLog })` 已支持从截断历史重建；kernel MessageLog 不动 |
| 消息撤回 | `truncateAfter(dbId)` 纯变换（照 compaction 模式） | dropLast/deleteMessage 已在 kernel/store |

## 小额清理（择机，可与任意 feature 搭车）

- `thinkingLevel: "medium"` 硬编码 → 进 AgentProfile 配置
- memory 产品化：app tool-registry、i18n 三语、presets 默认模板、侵入面 E2E 常驻脚本（当前 memory 是验收 capability，用户不可见）
- 测试残留：`(runner as any).log` 等私有内窥（live-session 壳删除后已大幅减少，余量在 compaction 测试）
- `docs/official/data-conventions.md` 可补 capability 私有文件清单（memory.jsonl 已补，未来新能力随做随记）

## 明确不做（已评估并否决）

- **control 事件走 middleware 管线**：control 请求是 exactly-once 送达 UI 的协议消息（request/resolve 关联），不是需要变换的流事件——middleware 是错误工具
- **SessionPort 背压**：事件走 WS，server 缓冲够用；高容量流式真出问题再加
- **attachment sanitizer / 持久化不变量 capability 化**：安全不变量不可拔插（README 哲学第 6 条）
- **身份 blocks（project-instructions/agent-profile/session-context/preloaded-context）capability 化**：assembly 本体（"agent 是谁"），capability 化是搬运不产生组合性
