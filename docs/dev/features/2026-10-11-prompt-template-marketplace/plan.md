# 实施计划

设计文档：design.md（同目录）。按依赖拓扑顺序实施，每项完成后勾选。

## 主仓库

- [x] 1. contracts：`packages/contracts/src/prompt-marketplace.ts`（schemas + 类型）+ `index.ts` 导出 + `api-contracts.test.ts` 用例
- [x] 2. server：`packages/server/src/prompt-marketplace.ts`（service：回退链/缓存/去重/大小限制）+ `src/routes/prompt-marketplace.ts` + `routes/index.ts` 注册 + `__tests__/prompt-marketplace-routes.test.ts`
- [x] 3. app categories 上提：`features/project-market/categories.ts` → `lib/categories.ts` 泛化，更新 ProjectMarketDialog import，迁移测试
- [x] 4. app API 层：`lib/api.ts` GlobalApiClient 增 `listMarketplacePrompts`；`queries/keys.ts` 增 prompts key；`queries/marketplace-prompts.ts`（promptLanguageFromLocale + useQuery + invalidate）+ 测试
- [x] 5. app UI：`features/agent-dialog/PromptTemplatesDialog.tsx`（列表/详情/复制/分类/三分支/404→empty）；AgentDialogForm 入口改造（删 PromptTemplatePicker、确认弹窗、相关 state）；删 `PromptTemplatePicker.tsx`；`AgentDialogForm.test.tsx` mock 补 `useGlobalApiClient`
- [x] 6. presets 移除：presets.json、templates/prompt-templates/、sync-templates.mjs、index.ts、sync-templates.test.ts、README.md
- [x] 7. i18n（先加载 i18n skill）：删 7 个 template* keys（保留 templatePresetsLabel）、增 `agent-dialog.templates.*` 11 keys，三语言
- [x] 8. desktop E2E：`e2e/prompts-marketplace.spec.ts`（stub server + env 注入）— 首跑通过
- [x] 9. `npm run verify` 全绿

## spherse-assets（~/workspace/spherse-assets）

- [x] 10. `prompts/worldview-assistant/` + `prompts/roleplay/`（zh-cn.md 迁移、en-us.md 起草、双语言 meta）
- [x] 11. `scripts/publish-prompts.mjs` + `publish-prompts.test.mjs`（14 用例）+ package.json scripts
- [x] 12. `.github/workflows/publish.yml`（inputs/build/ossutil 条件/upload）+ README
- [x] 13. spherse-assets `npm test` 通过 + `publish:prompts` dry-run 产出双语言 JSON 验证

## 收尾

- [x] 14. 文档同步（加载 doc-sync skill）：project-structure / data-conventions（新增提示词模板市场节）/ architecture（server、frontend、index）/ glossary（新增市场体系节）/ server README / presets README / backlog
- [ ] 15. commit（主仓库）→ 加载 code-review skill 派 sub agent review → 处理反馈
- [ ] 16. 提 PR + 贴 review report
