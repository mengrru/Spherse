# 文件删除 Feature

## 概述

在文件浏览器（FileTree）中支持右键菜单删除文件和目录。

## 设计决策

- **触发方式**：右键上下文菜单，包含「删除」选项
- **保护区域**：禁止删除 `.spherse/` 目录及其下内容，防止误删项目配置和 agent 定义
- **确认机制**：`window.confirm` 二次确认

## 变更范围

### 1. Server 层 — `packages/server/src/routes/content.ts`

新增 `DELETE /api/content/*` 路由：

- 解析相对路径为绝对路径
- 路径安全校验：`path.resolve + startsWith(rootPath)`
- 保护 `.spherse/`：路径以 `.spherse` 或 `.spherse/` 开头时返回 403
- 文件：`fs.unlink`
- 目录：`fs.rm(path, { recursive: true })`
- 成功返回 `{ ok: true }`

### 2. API Client — `packages/app/src/lib/api.ts`

新增 `deleteContent(path: string)` 方法，发送 `DELETE /api/content/{path}` 请求。

### 3. FileTree 组件 — `packages/app/src/components/FileTree.tsx`

- 右键节点时显示上下文菜单（绝对定位 div）
- 菜单项：「删除」（红色文字）
- 点击删除 → `window.confirm` → 调用 `client.deleteContent(path)`
- 删除成功后刷新文件树
- 点击菜单外区域或 ESC 关闭菜单
- 新增 `onDeleted?: (path: string) => void` 回调 prop

### 4. ProjectPage 联动 — `packages/app/src/pages/ProjectPage.tsx`

- 传递 `onDeleted` 回调给 FileTree
- 如果当前正在查看的文件被删除（`selectedFile` 是被删路径或其子路径），清除 `selectedFile` 并切换回 chat 视图
