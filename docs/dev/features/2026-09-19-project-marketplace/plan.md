# 项目市场实现计划

依据：`docs/dev/features/2026-09-19-project-marketplace/design.md`（含 review 修订）

## 任务清单

- [x] 1. contracts：`packages/contracts/src/project-marketplace.ts`（4 schema）+ index 导出 + 契约测试
- [x] 2. core：`moveDirAtomic` 抽共享 util；`packages/core/src/marketplace-project.ts` `installMarketplaceProjectZip` + 单测
- [x] 3. server：`marketplace.ts` 泛化（schema/entry/maxZipBytes/timeout/tmpPrefix 参数化）+ `projectMarketplaceService` 单例；`routes/project-marketplace.ts` 2 个全局路由 + 注册；契约测试
- [x] 4. app：`createGlobalApiClient` + `useGlobalApiClient`；`queries/marketplace-projects.ts`；app-store `openProjectAtPath`；activity-bar DropdownMenu 改造；`features/project-market/` Dialog；单测
- [x] 5. i18n：三语文案（加载 i18n skill）
- [x] 6. desktop：`select-directory` E2E seam（`SPHERSE_E2E_SELECT_DIRECTORY`）；E2E happy path
- [x] 7. spherse-assets：`projects/` + `scripts/lib/` 共享模块 + `publish-projects.mjs` + dry-run 单测 + workflow + README
- [x] 8. 验证：`npm run verify`（lint + build + typecheck + test）全绿；E2E project-marketplace.spec 通过；spherse-assets `npm test` 25 用例通过
- [x] 9. 文档同步（加载 doc-sync skill）：project-structure、architecture/server+frontend、data-conventions、backlog
- [ ] 10. commit + code-review skill 派 sub agent 审查 + 处理反馈

## 顺序依赖

1 → 3（server 用 contracts schema）；2 → 3（install 路由用 core 函数）；3 → 4（client 用 contracts 类型）；4 与 5 交织；6 依赖 1-5；7 与 1-6 并行无依赖；8 在 1-7 后；9、10 收尾。
