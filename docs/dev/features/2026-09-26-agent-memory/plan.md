# Agent 记忆实施计划

依据：`design.md`（含 review 修正）。按依赖拓扑排序。

## core（先行）

- [x] 1. `types.ts` AgentProfile 加 `memory?: { enabled: boolean }`；`store/agent-profile.ts` 归一化
- [x] 2. `store/memory.ts` 重写：MemoryStore（sqlite WAL + FTS5 trigram + 触发器、core.md、上限校验、LIKE 转义回退、损坏隔离重建、core.md 写互斥）
- [x] 3. `kernel/capability.ts` 加 `featureTools` 贡献点；`session/agent-assembly.ts` 白名单过滤后追加 + 重名跳过 warn + 不进 toolCatalog
- [x] 4. `access/path-category.ts` 加 `agentMemory` 类别（memory/** 对 LLM 读写均拒）
- [x] 5. `tools/memory-core-append.ts` / `memory-core-replace.ts` / `memory-save.ts` / `memory-recall.ts` / `memory-delete.ts`（重写，删旧 save/recall）
- [x] 6. `capabilities/memory/index.ts` 重写：featureTools 门控、memory-guide/memory-core blocks（末位、降级容错）、无 onAgentDeleted
- [x] 7. `agent-store.ts` 惰性 getter `memory` + `close()` 关连接；门面方法（enabled 走 updateAgent emit 路径，不新增 config-change 信号）
- [x] 8. core 测试：store（CRUD/上限/检索/损坏降级/并发）、capability（门控/blocks/deny rule）、检索 eval（recall@10 = 1.0、MRR ≥ 0.8、优于 substring 基线）、存量断言更新（presets.test.ts / memory.test.ts 重写）

## contracts

- [x] 9. `agents.ts`：agentProfile 加 memory 字段；agentMemory 五组 request/response schema + index 导出

## server

- [x] 10. `routes/agent-memory.ts` 五条路由 + 注册；契约测试（真实 runtime 不 mock 被测方法；desktop 无直接消费面，由该测试覆盖 HTTP 契约）

## app

- [x] 11. `lib/api.ts` 5 个 client 方法 + types re-export
- [x] 12. feature flag `agent-memory`（+ registry 测试更新）；actions-context/DialogState/AgentSessionDialogs/AgentRow 菜单项
- [x] 13. `features/agent-memory/MemoryDialog.tsx` + 组件测试（5 case）
- [x] 14. i18n 三语 21 keys（check:i18n 通过）

## presets（build 再生 dist）

- [x] 15. `assistant.md`（移除白名单工具、加 memory enabled）、`spherse-guide` 更新

## 收尾

- [x] 16. `npm run verify` 全绿（lint + build + typecheck + 1266 core / 317 server / 1186 app 等 + i18n check）
- [ ] 17. doc-sync：data-conventions / project-structure / architecture（capability + security）/ glossary / backlog
