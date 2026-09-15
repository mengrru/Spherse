# ADR-0012：chat hub 生命周期与所有权收口

- 状态：accepted
- 日期：2026-09-15
- 影响：`packages/server`（chat 域、registry、index、shutdown）、`packages/core`（SessionManager / AgentRunner）、`packages/desktop`（关停委托）

## 背景

`ChatSessionHub` 没有生命周期入口：project 移除只 shutdown runtime 不通知 hub，channel 可绑定已关闭 `SessionManager` 并复用 `projectId:sessionId` 旧 key；channel 在构造期发起 restore，可把 archived session 复活；`cleanupIfIdle` 直接 `destroySession`，让 transport 层掌握 core runner 的销毁权；server 关停顺序由 desktop 手工编排且不知道 hub 存在。

## 决策

- **hub 按 `SessionManager` 身份 × sessionId 索引 channel**：`closeRuntime` / `close` 同步收口（admission latch + 逐 channel close），channel 不晚于其 runtime 存活；runtime 身份进 key 使重新 register 天然获得新 channel
- **`ChatChannel` 是显式终态状态机（opening/open/closed）**：restore 延迟到首个 attach / detached run 单飞执行；lease 归零且无 run 时收口；close 与 release 正交（close 不释放、release 不关闭）；终态后命令确定性失败
- **runner 的空闲释放决策归 core**：`SessionManager.releaseSession`（busy 守卫）+ `restoreSession` admission 重检（archived / 已关闭 store 拒绝、init 后同步重检）；hub 不再调用 `destroySession`
- **server 关停单点**：`MultiProjectServer.close()`（hub → registry → fastify，阶段超时/失败隔离、幂等共享 Promise）；desktop 只注入超时与日志策略；registry `remove` 顺序为摘除 → 通知 hub → shutdown runtime，并有 removal barrier 防止同目录双开

## 后果

- 正：runtime 关闭后无残留 channel；archived session 不可复活；关停顺序可用 fakes 单测；hub/channel 的释放与终态不变量有测试钉住
- 负：core 仍无完整 admission/drain——trigger `restoreSession → sendMessage` 间隙仍可被 `releaseSession` 命中、project shutdown 的 `closeAll` 与 store close 之间仍有 pending restore 窗口；见 backlog「abort-and-drain」

## 原始记录

- `docs/dev/infra/2026-09-15-chat-hub-lifecycle/design.md`（完整设计、交错表与已知取舍）
