# Plan

- [x] 1. `queries/content.ts`：`directoryKeyMatchesChangedPath` predicate、`useProjectDirectory` enabled 选项、`invalidateProjectFileQueries` 精准失效
- [x] 2. `tree-model.ts` 重写 + `tree-model.test.ts` 重写
- [x] 3. `useFileTreeController.ts` 重写（expandedPaths / creating / deleteTarget）
- [x] 4. `file-tree-context.tsx` / `FileTreeNode.tsx` / `index.tsx` / `FileTreeContextMenu.tsx` / `DeleteConfirmDialog.tsx` 适配
- [x] 5. `content.test.ts` 补 directory predicate 测试
- [x] 6. lint + build + typecheck + `npm test --workspace=packages/app`（117 files / 1044 tests 通过）
- [x] 7. E2E `e2e/file-tree.spec.ts`（10/10）+ `e2e/floating-content-browser.spec.ts`（7/7，覆盖 float 菜单）
- [x] 8. commit、code-review、doc-sync
- [x] 9. review 反馈修复：删除成功后清理展开态、projectId 切换重置交互状态、TreeItemType 去 export、反斜杠归一化单测、删除已展开目录 E2E、design 已知取舍补记
