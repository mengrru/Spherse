# 实施计划

- [x] 1. core：`AgentProfile` 类型 + `parseFile` 解析 `quickLinks`；补 round-trip 测试
- [x] 2. contracts：`agentProfile` schema 加 `quickLinks`；更新 api-contracts 测试
- [x] 3. server：`agents-routes.test.ts` FULL_PROFILE fixture 加 `quickLinks`
- [x] 4. app 配置侧：`agent-markdown.ts` parse/build + 测试；`ContextPathField` → `PathListField` 泛化重命名；`AgentDialogForm` tab 改「个性化」+ quickLinks 编辑
- [x] 5. i18n：三语新增 4 个 key、删 `tabTheme`，`npm run check:i18n`
- [x] 6. app 消费侧：query key + `useProjectAgentProfile` + invalidation；`resolveQuickLinkAction` + 单测；`Header` 按钮行 + 结构测试；`QuickLinkPanel` + 测试；`Chat` 接线
- [x] 7. 主题钩子同步：agent-theme-template.css + sync 脚本、agent-chat-theme skill、theming.md（含「主题设置 UI」措辞）
- [x] 8. E2E：新增 `agent-quick-links.spec.ts`（桌面浮窗 + 关聊天不关浮窗 + 移动端面板 toggle）；review 反馈补 `agent-dialog.spec.ts` 配置侧 round-trip 用例
- [x] 9. 验证：`npm run verify`（lint + build + typecheck + test + i18n check）全绿
- [x] 10. commit → code-review skill 派 sub agent 审查 → 处理反馈（I1 补配置侧 E2E、m1 Header 去重、m2 basename 回退、m3 delete 失效缓存已修；m4 web 降级分支无集成测试暂不修——与 openFile 既有降级同款裸奔，仓库无 web E2E 设施）
- [x] 11. doc-sync 自查：data-conventions.md（quickLinks 字段 + theme.css 措辞）、project-structure.md（新 e2e spec）已更新；glossary / backlog / AGENTS.md / 包 README 无影响
