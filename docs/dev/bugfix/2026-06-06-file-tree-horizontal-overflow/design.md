# [Bugfix] 文件树水平溢出约束

## 问题描述

文件树在深层嵌套时，节点内容（`paddingLeft: depth * 16 + 8`）超出侧边栏宽度，导致水平溢出撑开整个侧边栏，影响整体布局。

## 复现步骤

1. 打开一个包含深层嵌套目录的项目（目录层级 ≥ 6）
2. 逐级展开目录
3. 观察到深层节点撑开侧边栏，整个页面布局被推开

## 根因分析

**位置**: `packages/app/src/features/project-panel/index.tsx:29`

侧边栏 `<aside>` 的 CSS 类为 `overflow-y-auto`，缺少 x 轴溢出约束：

```tsx
<aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar">
```

水平溢出来源：
1. **`FileTreeNode`** 的 `paddingLeft: depth * 16 + 8`（`FileTreeNode.tsx:43`）— 深层嵌套时 padding 线性增长
2. **`CollapsibleContent`** 的 `ml-2`（`FileTreeNode.tsx:103`）— 每级额外 8px margin，与 paddingLeft 重复计算
3. 侧边栏宽度固定 `w-60`（240px），深层节点内容超出后无水平约束

以 depth=8 为例：`paddingLeft = 8*16+8 = 136px`，加上图标 ~48px，剩余文本空间仅 ~56px，按钮内容极易溢出。

## 修复方案

**选择方案: 分层约束 + 移除重复缩进**

### 改动 1: `<aside>` 添加 `overflow-x-hidden`

文件：`packages/app/src/features/project-panel/index.tsx`

```diff
- <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar">
+ <aside className="flex w-60 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-border bg-sidebar">
```

效果：侧边栏整体不产生水平溢出。

### 改动 2: 文件树容器添加 `overflow-x-auto` + `min-w-0`

文件：`packages/app/src/features/project-panel/index.tsx`

在 `<SidebarGroupContent>` 的子容器上添加水平滚动能力：

```diff
  <SidebarGroupContent>
-   <FileTree ... />
+   <div className="overflow-x-auto min-w-0">
+     <FileTree ... />
+   </div>
  </SidebarGroupContent>
```

- `overflow-x-auto`：内容超出时显示水平滚动条
- `min-w-0`：允许 flex 子元素收缩到小于内容宽度（默认 `min-width: auto` 会阻止收缩）

### 改动 3: 移除 `CollapsibleContent` 的 `ml-2`

文件：`packages/app/src/features/file-tree/FileTreeNode.tsx`

```diff
- <CollapsibleContent className="ml-2">
+ <CollapsibleContent>
```

缩进已由 `paddingLeft: depth * 16 + 8` 完全控制，`ml-2` 是重复缩进，移除后缩进行为更可预测，同时减少水平溢出程度。

### 方案对比

| 方案 | 改动量 | 风险 | 说明 |
|------|--------|------|------|
| **A. 分层约束 + 移除重复缩进** (选择) | 3 处 | 低 | 精确控制，只有文件树可滚动 |
| B. `<aside>` 改 `overflow-auto` | 1 处 | 低 | 整个侧边栏水平滚动，不够精确 |

选择方案 A 理由：需求明确要求"只在文件树区域"设滚动条，分层约束更精确。

## 影响范围

- `packages/app/src/features/project-panel/index.tsx` — 2 处修改
- `packages/app/src/features/file-tree/FileTreeNode.tsx` — 1 处修改
- 不影响 `AgentSessionList` 区域
- 不影响文件树的点击、展开/收起、右键菜单等交互
- 移除 `ml-2` 后所有层级的缩进会略微减少（每级少 8px），视觉更紧凑

## 验证方式

1. 打开深层嵌套目录（≥ 6 级），确认文件树区域出现水平滚动条
2. 确认侧边栏宽度不变，不被撑开
3. 确认 agent/session 列表区域不受影响，无水平滚动
4. 确认文件树展开/收起交互正常
5. 确认浅层目录（≤ 3 级）无水平滚动条出现
