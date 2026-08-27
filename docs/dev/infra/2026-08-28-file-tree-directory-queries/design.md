# [Infra] 文件树改为目录 Query + expandedPaths

## 背景

对应 `docs/dev/infra/2026-08-22-frontend-architecture-followup/followup.md` 的 P1 条目「文件树改为目录 Query + expandedPaths」。

当前 `useFileTreeController` 在 TanStack Query 缓存（`directory(projectId, dirPath)`）之外又维护一棵包含服务端 children 的递归本地树（`TreeNode { expanded, loaded, children }`）。每次 invalidation 后通过 `refreshExpanded` 递归序贯重取所有已展开目录，再用 `mergeExpandedState` / `mergeRefreshedTree` 合并服务端数据与展开状态。问题：

- 服务端 children 双份存储；子目录级 query 缓存"只写不读"
- 刷新成本随展开目录数线性增长（`for...of + await` 串行请求），且 `refreshTree` 与被订阅根 query 的自动 refetch 造成双份遍历
- `invalidateProjectFileQueries` 对任何单文件变更都无条件失效全部 directory keys，fs-watch / agent 写文件期间每个 300ms 批次触发全量串行重取
- 双份状态带来展开/折叠竞态，两个 merge helper 即为补偿

## 目标

- 本地 state 只保存交互状态：`expandedPaths: Set<string>`、`creating`、`deleteTarget`；不再保存服务端 children 快照
- 每个目录节点组件自持 `useProjectDirectory`（`enabled: expanded`），Query 负责请求、缓存、去重和竞态
- 删除 `mergeExpandedState` / `mergeRefreshedTree` / `updateNode` / 递归 `refreshExpanded`
- invalidation 按父目录 + 后代路径精准失效，fs-watch 单文件变更只重取受影响的已订阅目录

## 非目标

- 不改 server API（`GET /content/:path` 不变）
- 不改 `FileTreeProps` 对外契约（`user-file-panel` / `skill-panel` 调用面零变化）
- 不引入虚拟滚动 / 树扁平化渲染

## 方案

### 数据模型（tree-model.ts）

```ts
export interface TreeItem {
  name: string;
  path: string;      // 项目相对全路径
  type: "file" | "directory";
}
export interface DeleteTarget {
  name: string;
  path: string;
  type: "file" | "directory";
}
```

`buildTreeItems(entries, parentPath)` 保留现有过滤（dotfiles）与排序（目录优先 + localeCompare），输出纯数据，不含 expanded/loaded/children。新增 `parentDirPath(path)`。保留导出 `INVALID_NAME_RE` / `CreateAction` / `CreatingState`（InlineNameInput、context 依赖）。删除 `TreeNode` / `buildNodes` / `updateNode` / `mergeExpandedState` / `mergeRefreshedTree`。

### Query 层（queries/content.ts）

- `useProjectDirectory(projectId, client, dirPath, options?: { enabled?: boolean })`：透传 `enabled`，目录未展开时不发起请求（disabled query 仍注册 observer，但不计入 active，invalidation 不会触发重取）
- 新增 `directoryKeyMatchesChangedPath(queryKey, projectId, changedPath)` predicate，三种匹配均基于归一化（反斜杠 → 正斜杠）后的 `changedPath`（归一化在 `invalidateProjectFileQueries` 入口统一完成，content predicate 复用同一份归一化结果）：
  - `dirPath === changedPath`（变更对象本身是目录）
  - `dirPath` 以 `changedPath + "/"` 开头（后代目录，删除目录场景）
  - `dirPath === parentDir(changedPath)`（直接父目录，listing 变化）
- `invalidateProjectFileQueries(projectId, changedPath)` 将「全量失效 directories」改为上述 predicate；content keys 与 fileTree index 失效行为不变；无 `changedPath` 时仍全量失效（重连场景）

### Controller（useFileTreeController.ts）

不再持有 `rootNodes`，只管理：

```ts
expandedPaths: ReadonlySet<string>   // toggleDir / 展开清理
creating: CreatingState | null
deleteTarget: DeleteTarget | null
```

- `toggleDir(path)`：Set 增删
- `requestCreate(item, action)`：目录 → 以目录为 parent 并展开；文件 → 以 `parentDirPath` 为 parent
- `submitCreate`：mkdir / touchFile 成功后 `invalidateProjectFileQueries(projectId, targetPath)`（精准失效父目录）；失败仅 toast，保留 `creating`（输入框不消失，与现状一致）
- `confirmDelete`：删除成功后失效变更路径；同时清理 `expandedPaths` 中被删路径及其后代（避免本地删除后重建同名目录时幽灵展开态）
- 根 query（loading / 空态）上移到 `FileTree` 组件

### 组件层

- `FileTree`（index.tsx）：自持根 `useProjectDirectory(projectId, client, basePath)`，渲染根级 rows + 根级 InlineNameInput + DeleteConfirmDialog
- `FileTreeNode.tsx` 导出 `FileTreeItem({ item, depth })`：
  - 文件 → `TreeRow`（点击 `selectFile`），非 readOnly 时由 `FileTreeContextMenu` 包裹（new-file/new-folder 以文件父目录为 parent、copy-path、delete、float）
  - 目录 → `DirectoryNode`：自持 `useProjectDirectory(..., { enabled: expanded })`，chevron 即时旋转（展开态来自 expandedPaths），首次展开 pending 时显示 loading 行；`query.data` 经 `buildTreeItems` 渲染子节点（递归组件，hook 合法）；非 readOnly 时 row 由 `FileTreeContextMenu` 包裹；readOnly 时文件与目录均渲染裸 row（无 menu、无 float）
  - Base-UI Collapsible Panel 默认关闭即卸载：折叠后子树组件卸载、子目录 query 退订，invalidation 不再触发隐藏重取
- `file-tree-context` 增加 `projectId` / `client` / `expandedPaths` / `selectFile`；`requestDelete(item: TreeItem)`、`requestCreate(item: TreeItem, action)`；`toggleNode` 拆为 `selectFile` + `toggleDir`
- `FileTreeContextMenu` 的 `node`、`DeleteConfirmDialog` 的 `target` 换用新类型（字段用法不变）

### 语义保证

- 空目录 vs 未加载：`query.data === []` 为空目录；`enabled && query.isPending` 为加载中（Query pending ≠ collapsed）
- 目录 query error：按空目录渲染（对齐现状 `loadChildren` catch → `[]` 的静默降级）；目录被外部删除后，父级 listing 刷新会使该节点整体卸载，孤儿 query 不再被渲染
- `staleTime: Infinity` 下折叠不删缓存，重新展开命中缓存即渲染；若缓存已被精准失效则重新请求（E2E「re-expanding a collapsed folder shows fresh content」由 fs-watch → 精准失效 → 重新订阅重取保证）
- 并发安全：展开状态是唯一本地写入方，children 一律来自 Query，无 merge 时序问题

### 已知取舍

- fs-watch 外部删除已展开目录且之后重建同名目录：`expandedPaths` 残留会使新目录自动展开（无数据正确性问题，children 来自新请求）；不为此外部删除场景引入额外的展开态清理机制
- predicate 匹配区分大小写：大小写不敏感文件系统上 fs-watch 路径大小写与 key 不一致时会 miss（现状靠全量失效免疫）；记录为已知限制

## 影响文件

| 文件 | 变更 |
|---|---|
| `packages/app/src/queries/content.ts` | directory predicate + enabled 选项 + 精准失效 |
| `packages/app/src/queries/content.test.ts` | 新增 directory 失效测试 |
| `packages/app/src/components/file-tree/tree-model.ts` | 重写为纯数据模型 |
| `packages/app/src/components/file-tree/tree-model.test.ts` | 重写 |
| `packages/app/src/components/file-tree/hooks/useFileTreeController.ts` | 重写为交互状态 controller |
| `packages/app/src/components/file-tree/file-tree-context.tsx` | context 值适配 |
| `packages/app/src/components/file-tree/FileTreeNode.tsx` | FileTreeItem + DirectoryNode（自持 query） |
| `packages/app/src/components/file-tree/index.tsx` | 根 query + 装配 |
| `packages/app/src/components/file-tree/FileTreeContextMenu.tsx` | 类型替换 |
| `packages/app/src/components/file-tree/DeleteConfirmDialog.tsx` | 类型替换 |

## 测试计划

- 单测：`tree-model.test.ts`（buildTreeItems 过滤/排序/路径、parentDirPath）；`content.test.ts`（directory predicate：父目录命中、后代命中、兄弟不命中；全量失效路径不变）
- E2E：`npm run test:e2e --workspace=packages/desktop -- e2e/file-tree.spec.ts`（展开/折叠、重新展开取新、context menu 创建文件/文件夹、删除、取消）

## 验收标准（对齐 followup doc）

- 本地 state 不再保存服务端 children 快照
- 删除 `mergeExpandedState` / `mergeRefreshedTree`
- fs-watch 按父目录精准失效
- 创建、删除、嵌套展开、重连和项目切换 E2E 覆盖保持通过
