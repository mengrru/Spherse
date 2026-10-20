# Plan

设计文档：`docs/dev/features/2026-10-21-agents-md-llm-edit/design.md`

- [ ] T1 access-policy：`LLM_WRITE` + `rootIndex`；新增 `LLM_TRANSFER_DEST` / `LLM_MOVE_SOURCE` 集合与 `assertTransferDest` / `assertMoveSource` / `canTransferDest` / `canMoveSource`；`assertAllowed` action 扩展（pathRule 取 `rule.llm.write`，错误消息 kind 可读化）
- [ ] T2 path-category：`rootIndex` 模式大小写不敏感匹配（仅该类别）
- [ ] T3 工具接线：`copy-file.ts` dest → `assertTransferDest`；`move-file.ts` source → `assertMoveSource`、dest → `assertTransferDest`
- [ ] T4 测试：path-category 大小写用例；access-policy 矩阵更新 + 新 kind 矩阵 + deniedPaths 阻断 + server 新 kind 钉住；write/edit/copy/move 工具级用例（正向 + 拒绝 + 大小写变体）；path-rules 补新 kind 裁决；非回归确认
- [ ] T5 文档：security.md、project-structure.md、backlog.md 新条目、spherse-guide SKILL.md
- [ ] T6 验证：core 单测、lint、build、typecheck
- [ ] T7 commit + code-review skill 子代理审查 + 反馈处理
- [ ] T8 doc-sync 自查 + PR（base=dev）
