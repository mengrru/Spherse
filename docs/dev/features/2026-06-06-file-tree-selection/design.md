# File Tree 文件选中态

## 背景

当前文件树 (`features/file-tree/`) 中，用户点击文件节点会通过 `onSelectFile` 回调导航到 ContentBrowser 查看文件内容，但文件树本身没有任何视觉反馈指示当前正在查看哪个文件。用户需要靠记忆或查看右侧内容区来确认当前文件，侧栏与主内容区之间缺少视觉关联。

当前活跃文件的路径已通过 URL search params (`?path=...`) 存在于 `ProjectLayout` 中（`contentPath = searchParams.get("path")`），只是没有传递到文件树组件用于视觉渲染。

## 目标

- 文件树中，当前正在查看的文件节点显示持久选中态（高亮背景 + 加粗文字），与普通态和 hover 态明确区分。
- 选中态与 URL 中的 `path` 参数保持同步：无论用户从文件树点击、从 chat 中的工具调用路径链接、还是浏览器前进/后退导航，选中态都准确反映当前查看的文件。
- 用户不在内容浏览视图时（如在 chat 页面），文件树无选中态。
- 文件删除后，选中态随导航自动清除。

## 非目标

- 不实现多选。
- 不为目录节点添加选中态（目录只有展开/折叠）。
- 不新增 CSS 变量或修改 `styles.css` 色彩体系，复用现有 shadcn sidebar 语义 token。
- 不引入全局 store 或 feature 级 store。

## 方案比较

### 方案 A：在 FileTree 内部用 `useSearchParams` 读取当前路径

`FileTree` 组件直接调用 `useSearchParams()` 获取 `path` 参数，自行比较决定选中态。

优点：不改变任何外部组件的 props 传递链，FileTree 完全自包含。缺点：FileTree 与路由实现耦合，违反组件独立性原则；如果将来文件树被用在非路由场景（如弹窗中选择文件），需要额外重构。

### 方案 B：从 ProjectLayout 通过 props 传递 `selectedFilePath`（推荐）

`ProjectLayout` 已持有 `contentPath`，将其作为新 prop 传递：`ProjectLayout → ProjectPanel → FileTree → FileTreeNode`。

优点：数据流单向清晰，遵循 React props 传递的既有模式；FileTree 不感知路由细节，保持组件纯粹性；选中态的数据来源单一（URL），不会出现不一致。缺点：需要在中间组件（`ProjectPanel`）增加 prop 透传。但 `ProjectPanel` 本身就是薄壳组件，prop 透传开销极低。

### 方案 C：在 `project-ui-store` 中存储选中文件路径

将 `selectedFilePath` 加入 `project-ui-store`，各组件从 store 读取。

优点：跨组件共享方便。缺点：选中态完全由 URL 路由驱动，是 layout 级的派生状态，放入 store 会引入同步负担（需在 URL 变化时同步 store，store 变化时更新 URL），不符合现有 store 使用原则——"跨页面、跨 feature 持久的状态放 store；短生命周期状态用 useState 保留在组件内"。

本次选择方案 B。选中文件路径是 URL 的派生状态，生命周期与路由绑定，通过 props 传递最简单直接。

## 设计细节

### Props 变更

**`FileTreeProps`**（`features/file-tree/index.tsx`）新增：

```ts
selectedFilePath?: string;
```

**`ProjectPanelProps`**（`features/project-panel/index.tsx`）新增：

```ts
selectedFilePath?: string;
```

### 选中态样式

当前文件节点行的样式：

```tsx
// 现有样式（未选中态）
"w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
```

选中时，在行上增加持久背景和字重：

```tsx
const isSelected = node.type === "file" && node.path === selectedFilePath;

const fileRowClass = isSelected
  ? "w-full justify-start gap-2 bg-sidebar-accent text-sidebar-accent-foreground font-medium"
  : "w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
```

- 选中态：`bg-sidebar-accent` 持久背景（Light `#f5f5f5` / Dark `#262626`）+ `text-sidebar-accent-foreground` 文字色 + `font-medium` 加粗。
- 未选中态：保持现有样式不变（无背景，hover 时 `bg-sidebar-accent`）。
- 选中态不再需要 hover 背景变化（已有持久背景），hover 效果仅作用于未选中节点。

### 数据流

```
URL ?path=xxx
  → ProjectLayout (contentPath)
    → ProjectPanel (selectedFilePath={contentPath})
      → FileTree (selectedFilePath)
        → FileTreeNode (selectedFilePath)
          → 比较 node.path === selectedFilePath → 应用选中样式
```

触发时机：

1. 用户点击文件树文件 → `onSelectFile` → `navigate(buildContentUrl(...))` → URL 变化 → `contentPath` 更新 → 选中态同步更新。
2. 用户从 chat 中点击工具调用的文件路径链接 → URL 变化 → `contentPath` 更新 → 选中态同步更新。
3. 用户点击浏览器后退 → URL 变化 → `contentPath` 更新 → 选中态同步更新。
4. 用户从内容页返回 chat → `contentPath` 为 null → 选中态清除。
5. 文件删除 → `handleFileDeleted` 导航回 chat → `contentPath` 为 null → 选中态清除。

### 边界情况

- **`selectedFilePath` 为 undefined 或空字符串**：不选中任何文件。
- **`selectedFilePath` 对应的文件在树中不可见**（父目录未展开）：不选中任何节点，不自动展开父目录。用户手动展开后，如果 URL 仍指向该文件，选中态会出现。
- **外部修改导致文件被删除**：FS watch 触发刷新后，该节点从树中移除，选中态自然消失。URL 可能仍指向该路径，但这属于已有的 URL 与实际状态不一致问题，不在本 feature 范围内处理。

### 需修改的文件

| 文件 | 变更 |
|------|------|
| `packages/app/src/layouts/ProjectLayout.tsx` | 向 `ProjectPanel` 传入 `selectedFilePath={contentPath}` |
| `packages/app/src/features/project-panel/index.tsx` | 新增 `selectedFilePath` prop，透传给 `FileTree` |
| `packages/app/src/features/file-tree/index.tsx` | 新增 `selectedFilePath` prop，透传给 `FileTreeNode` |
| `packages/app/src/features/file-tree/FileTreeNode.tsx` | 新增 `selectedFilePath` prop，根据 `node.path === selectedFilePath` 应用选中样式 |

共 4 个文件，变更量小，不涉及新组件、新 store、新 CSS 变量或 API 变更。

## 测试策略

- 修改后运行 `npm run lint` 确认代码风格合规。
- 运行 `npm test --workspace=packages/app` 确认现有测试通过。
- 手动验证：点击文件树文件、从 chat 导航到文件、删除文件后返回 chat，确认选中态正确显示和清除。

## 文档同步

本 feature 不引入新文件/目录、新工具或架构变更，不需要更新 `docs/official/`。

## 验收标准

- 文件树中，当前正在查看的文件节点显示持久选中态（背景高亮 + 文字加粗）。
- 未选中的文件节点保持原有默认样式和 hover 效果。
- 目录节点不受影响。
- 从任何入口导航到文件内容后，选中态准确同步。
- 返回 chat 或文件被删除后，选中态正确清除。
- `npm run lint` 和 `npm test --workspace=packages/app` 通过。
