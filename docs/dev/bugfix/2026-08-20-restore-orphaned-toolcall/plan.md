# 实施计划：restore 孤儿 toolCall 自愈

1. [x] 失败测试：`agent-runner.test.ts` 补两条用例（部分应答 → 合成 + 持久化 + 幂等；完整应答 → 不动）
2. [x] 纯函数 `synthesizeInterruptedToolResults` 落 `session/compactor.ts`
3. [x] `AgentRunner.initForRestore` 接线（合成 → appendMessage → appendEntry）
4. [x] core 全量测试 + lint + server 测试对账（失败均为存量）
5. [x] bugfix 文档 + backlog 条目
