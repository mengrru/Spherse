# 自定义侧边面板实施计划

依据：[design.md](./design.md)

- [x] 1. core：`ProjectConfig.sidePanel` 类型 + `normalizeSidePanelPath` + `getSidePanelSettings`/`updateSidePanelSettings` + PM 门面 + 单测
- [x] 2. contracts：`sidePanelSettingsRequest/Response` schema + api-contracts null coercion 测试
- [x] 3. server：`GET/PUT /settings/side-panel` 路由 + `settings-side-panel.test.ts` 契约测试
- [x] 4. app：api client 方法 + `queries/custom-side-panel.ts` + query key
- [x] 5. app：`stores/custom-side-panel-store.ts` + 单测
- [x] 6. app：`features/custom-side-panel/`（CustomSidePanel 组件 + QueryBridge）+ 组件测试
- [x] 7. app：ProjectPanel 视图二选一（`key={projectId}`）
- [x] 8. app：`features/project-settings/side-panel-settings/` dialog
- [x] 9. app：ActivityBar 菜单项 + dialog 挂载；ProjectRuntimeBridges 挂 bridge；project-lifecycle 级联 `clearProject`；结构/级联测试更新
- [x] 10. i18n：三 locale 新 key（已加载 i18n skill，check:i18n 通过）
- [x] 11. lint + typecheck + 相关包测试全绿（core presets.test.ts 失败为基线既有，与本改动无关）
- [ ] 12. 文档同步（doc-sync skill）：data-conventions / project-structure / frontend.md
