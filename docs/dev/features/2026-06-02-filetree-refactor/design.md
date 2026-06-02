# FileTree 重构设计

## 背景

当前文件树实现集中在 `packages/app/src/components/FileTree.tsx`，同时承担数据加载、文件系统 watch 刷新、树节点构建与更新、展开状态、创建/删除状态、确认弹窗、内联输入、递归节点渲染和右键菜单渲染。近期文件删除和新建能力继续叠加到同一文件后，组件边界已经不清晰。

项目前端已经按 feature 组织主要业务 UI，`docs/official/project-structure.md` 中也将 `features/` 作为业务组件目录。FileTree 目前仍位于共享 `components/`，但它只服务项目侧栏的文件浏览交互，不是通用基础组件。本次重构目标是把它迁移到 `features/file-tree`，拆分职责，并梳理状态边界。

## 目标

- 新增 `packages/app/src/features/file-tree/`，对外导出 `FileTree`。
- 将单文件大组件拆成容器、视图组件、纯模型工具和 feature 内 hook。
- 保持现有用户行为：展开/折叠、懒加载目录、点击文件、右键新建文件、右键新建文件夹、删除确认、文件系统 watch 后刷新已展开目录。
- 保持现有 API 契约：`client.listContent`、`client.mkdir`、`client.touchFile`、`client.deleteContent`、`client.createFsWatchWebSocket`。
- 不引入全局 store，除非实现时发现状态需要跨组件共享或跨卸载保留。

## 非目标

- 不改 Server 层 file/content API。
- 不改 AgentDialog 中基于 `getFileTree()` 的参考资料路径建议逻辑。
- 不新增拖拽、重命名、搜索、虚拟滚动或多选能力。
- 不调整文件树视觉风格，仅在拆分过程中保留现有 Tailwind 和 shadcn/ui 使用方式。

## 方案比较

### 方案 A：只把现有文件移动到 `features/file-tree`

优点是改动最小，迁移风险低。缺点是 400 行组件仍然混合多个职责，不能解决本次“组件拆分”和“状态梳理”的核心诉求。

### 方案 B：feature 目录 + 本地 controller hook（推荐）

在 `features/file-tree` 内保留一个轻量 `FileTree` 容器，用 `useFileTreeController` 管理数据、状态和操作，把树节点渲染、内联输入、删除确认弹窗拆成独立组件，把树构建和更新逻辑拆到纯函数模块。优点是边界清晰、行为不变、状态仍然贴近唯一使用点，符合现有“短生命周期状态保留在组件/feature 内”的 store 原则。缺点是需要重排导入和补充测试。

### 方案 C：引入 feature 级 Zustand store

把 `rootNodes`、展开状态、创建状态、删除目标和刷新操作放入 `features/file-tree/store.ts`。优点是如果未来多个入口共享同一文件树状态会更方便。缺点是当前 FileTree 只有项目侧栏一个交互入口，状态生命周期也应随组件卸载释放；提前引入 store 会增加样板和清理复杂度。

本次选择方案 B。feature 级 store 作为保留选项，不在本次设计中默认引入。

## 目录结构

```text
packages/app/src/features/file-tree/
├── index.tsx
├── FileTreeNode.tsx
├── FileTreeContextMenu.tsx
├── InlineNameInput.tsx
├── DeleteConfirmDialog.tsx
├── hooks/
│   ├── useFileTreeController.ts
│   └── useFsWatchRefresh.ts
├── tree-model.ts
└── tree-model.test.ts
```

### `index.tsx`

对外导出 `FileTree`，保留当前 props：

```ts
interface FileTreeProps {
  client: ApiClient;
  onSelectFile: (filePath: string) => void;
  onDeleted?: (path: string) => void;
  refreshKey?: number;
}
```

`FileTree` 只负责组合 controller 和视图：读取 `nodes`、`creating`、`deleteTarget`、handler，并渲染空/加载状态、根节点列表、根目录内联输入和删除确认弹窗。

### `hooks/useFileTreeController.ts`

集中管理 feature 内状态和副作用：

- `rootNodes: TreeNode[]`
- `creating: CreatingState | null`
- `deleteTarget: TreeNode | null`
- `loadChildren(parentPath)`
- `refreshRoot()`
- `toggleNode(node)`
- `requestCreate(node, action)`
- `submitCreate(parentPath, action, name)`
- `requestDelete(node)`
- `confirmDelete()`
- `cancelCreate()` / `cancelDelete()`

`nodesRef` 可继续放在 hook 内，用于刷新时保留旧节点的展开、loaded 和 children 状态。`refreshKey` 仍触发根目录重新加载，`useFsWatchRefresh` 仍对 watch 事件做 300ms debounce 后调用 `refreshRoot()`。

### `tree-model.ts`

放置纯类型和纯函数：

- `TreeNode`
- `CreatingState`
- `CreateAction`
- `INVALID_NAME_RE`
- `buildNodes(entries, parentPath)`
- `updateNode(nodes, path, update)`
- `mergeExpandedState(newNodes, oldNodes)`

`mergeExpandedState` 用于替代当前散落在 `refreshRoot` 和 `refreshExpanded` 中的旧状态合并逻辑，让刷新行为可单测。

### 视图组件

`FileTreeNode.tsx` 负责递归渲染一个节点，区分文件和目录。它不直接调用 API，只接收节点、深度、创建状态和 handler。

`FileTreeContextMenu.tsx` 负责菜单项渲染，统一文件/目录的“新建文件”“新建文件夹”“删除”菜单，避免文件节点和目录节点重复菜单 JSX。

`InlineNameInput.tsx` 只负责输入框行为：自动聚焦、Enter 提交、Escape/blur 取消、空值和非法名称不提交。

`DeleteConfirmDialog.tsx` 只负责确认弹窗文案和确认/取消回调。

## 状态边界

本次不引入全局 `project-ui-store` 或 feature 级 Zustand store。

原因：

- 文件树展开、loaded children、创建输入和删除确认都只被 `FileTree` 使用。
- 这些状态是项目侧栏的短生命周期 UI 状态，组件卸载时丢弃符合现有前端 store 原则。
- Server 与 API 已经是数据来源，前端不需要缓存成全局业务数据。

如后续出现以下需求，再引入 `features/file-tree/store.ts`：

- 文件树展开状态需要在 route 切换或侧栏卸载后保留。
- 多个组件需要同时读取或修改同一份文件树 UI 状态。
- 文件树刷新需要与其它 feature 共享统一队列或状态。

## 数据流

1. `ProjectPanel` 从 `features/file-tree` 导入 `FileTree`，继续传入当前 project 的 `client`、`onSelectFile` 和 `onFileDeleted`。
2. `FileTree` 初始化时通过 controller 调用 `client.listContent("")` 加载根目录。
3. 用户点击目录时，如果未 loaded，则调用 `client.listContent(node.path)` 懒加载 children，再切换 expanded。
4. 用户点击文件时，controller 调用 `onSelectFile(node.path)`。
5. 用户新建文件/文件夹时，controller 校验名称，调用 `client.touchFile` 或 `client.mkdir`，成功后关闭输入并刷新根节点及已展开目录。
6. 用户删除时，controller 调用 `client.deleteContent`，成功后调用 `onDeleted?.(node.path)` 并刷新。
7. 文件系统 watch 事件触发时，`useFsWatchRefresh` debounce 后调用 `refreshRoot()`，刷新后保留仍存在节点的展开状态。

## 错误处理

- `listContent` 失败时沿用现有行为返回空列表，避免侧栏因单次读取失败崩溃。
- 新建和删除失败继续使用 `toast.error` 展示错误信息。
- 输入校验继续禁止空名称和包含 `/`、`\`、`:` 的名称。
- 删除确认弹窗关闭时清空 `deleteTarget`，避免目标过期。

## 测试策略

- 为 `tree-model.test.ts` 增加单元测试，覆盖：dotfile 过滤、目录优先排序、路径拼接、递归 update、刷新合并展开状态。
- 如 app 现有测试环境适合 React 组件测试，可补充 `FileTree` 或 controller hook 的轻量测试，覆盖 create/delete handler 调用和 refreshKey 触发刷新。
- 至少运行 `npm test --workspace=packages/app` 验证前端相关测试。

## 文档同步

实现完成后需要更新 `docs/official/project-structure.md`：

- 从共享 `components/FileTree.tsx` 移除文件树说明。
- 在 `features/` 下新增 `file-tree/` 说明。

`docs/official/architecture.md` 的 Server 层文件树 API 描述无需变化。

## 验收标准

- `packages/app/src/features/file-tree` 存在并导出 `FileTree`。
- `ProjectPanel` 改为从 `../file-tree` 或等效 feature 路径导入。
- 原 `packages/app/src/components/FileTree.tsx` 不再保留业务实现。
- 文件树现有交互行为保持不变。
- 状态集中在 `useFileTreeController`，纯树操作集中在 `tree-model.ts`。
- `tree-model` 有单元测试覆盖核心纯函数。
- `npm test --workspace=packages/app` 通过。
