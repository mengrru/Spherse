# 实现计划：Agent 参考资料格式与总大小限制

Design doc: `design.md`

## 任务清单

- [x] 1. presets：`src/context-file-policy.ts`（常量 + `isTextContextPath`）+ index 导出 + 单测
- [x] 2. contracts：`src/context-files.ts`（inspect request/response schemas）+ index 导出 + schema 测试
- [x] 3. core：
  - [x] 3a. `src/session/context-file-policy.ts`：`inspectContextFiles` / `assertContextFilesWithinPolicy`
  - [x] 3b. `read-context-files.ts` L3 兜底（扩展名检查 + stat 贪心装填 + 可选 logger）+ `agent-assembly.ts` 传 logger
  - [x] 3c. `store/project.ts` createAgent/updateAgent 接入 L2 校验
  - [x] 3d. `tools/manage-agent.ts` context 参数 description 补约束
  - [x] 3e. index 导出 + 单测（inspect / assert / readContextFiles 新行为 / ProjectStore 拒绝）
- [x] 4. server：`routes/context-files.ts` POST inspect + 注册 + 路由测试 + create/update 拒绝契约测试
- [x] 5. app：`lib/api.ts` inspectContextFiles + `SearchFileField` filter prop + `ContextPathField` 添加校验与用量行 + 组件测试
- [x] 6. i18n：`refsFormatError` / `refsSizeError` / `refsUsage` / `refsInspectError` 三语言
- [ ] 7. 验证：相关 workspace lint + typecheck + 单测，`npm run verify`
- [ ] 8. doc-sync：data-conventions / architecture / presets README / project-structure / backlog
