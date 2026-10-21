# Plan

- [x] core：`ProjectManager.renamePath` + `project-manager-write.test.ts` 用例
- [x] contracts：`contentRenameRequest` schema + 导出
- [x] server：`PATCH /content/*` rename 路由 + `write-facade-contract.test.ts` 契约用例
- [x] app api client：`renameContent`
- [x] app controller：renaming 状态 + request/cancel/submitRename + projectId reset + skills 失效
- [x] app 菜单：`FileTreeContextMenu` Rename 置首（onRename 门控 + 分隔符）
- [x] app 内联编辑：`InlineNameInput` defaultValue + `FileTreeNode` 原位替换
- [x] app 线程：`FileTree.onRenamed` + user-file-panel/skill-panel 关旧路径标签与分窗
- [x] i18n：`file-tree.renameFailed` 三语
- [x] app 测试：菜单顺序/门控/其他项可用 + controller 用例
- [x] 文档：server.md content 路由行补重命名
- [ ] 验证：`npm run verify`
- [ ] sub agent code review + 修反馈
- [ ] PR（Refs #153/#64）
