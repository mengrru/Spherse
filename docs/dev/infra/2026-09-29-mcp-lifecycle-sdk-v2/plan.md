# 实施计划

依据：`design.md`（同目录）。每项完成后勾选。

## Commit 1：SDK v2 迁移（纯机械）✅ 156a2032

- [x] `packages/core/package.json`：`@modelcontextprotocol/sdk` → `@modelcontextprotocol/client`（实装 2.2.0）
- [x] `mcp/mcp-client.ts`：imports 换 v2 + `versionNegotiation: { mode: "auto" }`
- [x] 删自研分页，SDK 自动聚合 + 异常转空列表 warn
- [x] 既有测试适配（v2 callTool 两参签名）

## Commit 2：manager 重构 + mcp-client 生命周期（P1/P3/P4/P5/P6）✅

- [x] `connectMcpServer` 增 `opts: { signal?; onDisconnect? }`；signal 贯穿 connect/list（含 abortGuard race——实测 v2 probe 不吃 signal，必须自建 guard + connect 传 `timeout`）
- [x] `client.onclose` + `closedByUs`（close 前置位）+ `closed` getter + close 5s 兜底
- [x] stderr 封顶 8KB + 成功后解绑；stale 注释修复
- [x] manager 重构：per-server entry、退避 30s×2 封顶 10min、per-agent revision/epoch、load pass 串行化、20s 预算、epoch 不符关闭不缓存返回空集、连接即死（closed）按失败处理、聚合层死连接剔除 + bump
- [x] capability memo → revision（自愈合并提前并入本 commit：strip `mcp__` 工具 + sentinel block，与 revision 语义不可分）
- [x] block.ts sentinel 包裹
- [x] 测试：manager 16 用例重写 + connect-lifecycle 5 用例（真 stdio fixture server）+ mcp-merge 4 用例 + mcp-block 更新

## Commit 3：beforeTurn 自愈 + emit + retry（P2 + backlog:34）✅ 98737ad1

- [x] `store/project.ts` `updateAgentMcp`（save + emit "updated"）；`project-manager.ts` 委托
- [x] `agent-runner.ts` retryLastTurn applyReload 后补调 beforeTurn
- [x] 测试：store emit 用例 + M5 用例补 beforeTurn/onReload 断言
- [x] backlog:34 条目删除

## Commit 4：sse 移除 ✅ 7adf1389

- [x] types/config/index/mcp-client 清理；normalize `onWarn`；McpConfigStore 接 logger
- [x] contracts 删 sse variant + 拒绝用例
- [x] app TRANSPORT_OPTIONS + i18n 三 locale
- [x] config.test.ts 更新 + sse 丢弃 onWarn 用例

## 收尾：verify + doc-sync

- [x] `npm run verify`（全绿）
- [x] doc-sync（capabilities.md / data-conventions.md / ADR-0014 / backlog）
- [x] code review sub agent + 反馈处理（见 design「Code review 处理」）
- [ ] PR

## 实现过程的关键偏差记录（供 review 参考）

1. **v2 `connect` 的 signal 不覆盖 era probe**：`auto` 模式对 stdio 先 spawn 探测进程，probe 只吃 `timeout` 选项不吃 signal（实测挂死）。最终方案：connect 传 `{ timeout: 15s, signal }` + 自建 abortGuard race 整个 connect+list 阶段，manager 侧 20s AbortSignal 兜底。
2. **capability 自愈合并并入 commit 2**：review 后发现 revision 语义与 append-only 合并不兼容（bump 会造成重复追加），提前实现 strip+re-merge。
3. **`node -e script --flag` 会被 node 解析为自身选项**：测试 fixture 改用环境变量传模式。
4. **连接即死竞态**：server 在 connect 成功与缓存之间断开时 onclose 已消费，补 `closed` getter 在缓存与聚合两层校验。
