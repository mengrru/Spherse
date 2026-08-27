# Plan

- [x] 1. `streaming-store` 新增 `disconnectProject(projectId)` + 单测
- [x] 2. `lib/use-project-navigation.ts` 新增 `clearProjectNavHistory(projectId)`
- [x] 3. 新增 `layouts/project-lifecycle.ts`：`closeProjectCascade`（app-store close，失败即抛不动本地 → disconnectProject → clearProjectQueries → 5 个 feature store clearProject → clearProjectData → clearProjectNavHistory → clearLastRoute）
- [x] 4. `use-project-actions.ts` 的 `handleCloseProject` 改调 cascade，移除直接清理依赖
- [x] 5. 新增 `layouts/ProjectRuntimeBridges.tsx`（fragment：3 manager + 5 bridge），`ProjectScope` 改为渲染该组件
- [x] 6. 新增 `project-lifecycle.structure.test.ts`（递归扫描 `create<...Store>(` 定义的 store 文件，定义 `clearProject`/`clearProjectData` 的必须出现在 cascade 源码；断言四个非 store 清理面）与 `ProjectRuntimeBridges.structure.test.ts`；更新 `ProjectScope.structure.test.ts`
- [x] 7. 回归：`npm test --workspace=packages/app`、lint、typecheck、项目关闭相关 E2E
- [ ] 8. doc-sync：`packages/app/README.md` 编排层现状、followup P2 状态、`docs/official/project-structure.md`、backlog


