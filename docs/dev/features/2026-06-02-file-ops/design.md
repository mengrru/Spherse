# 文件/文件夹新建 Feature

## 概述

在文件浏览器（FileTree）中通过右键上下文菜单支持新建空文件和新建文件夹。仅面向 UI 用户交互，不涉及 Agent 工具侧变更。

## 设计决策

- **触发方式**：右键上下文菜单，仅在文件夹节点显示「新建文件」「新建文件夹」「删除」，文件节点菜单不变（仅「删除」）
- **内联输入**：点击菜单项后在树节点旁展示 input 框（类似 VS Code 新建交互），回车确认、Esc 取消
- **保护区域**：禁止在 `.spherse/` 下创建，与已有删除保护规则一致
- **方案选择**：扩展现有 `content.ts` 路由（方案 A），复用路径安全校验逻辑

## Toast 基础设施

- 引入 `sonner` 库作为全局 toast 方案
- 在 App 根组件挂载 `<Toaster />`，使用 CSS 变量配色
- 封装 `components/ui/sonner.tsx`（参考 shadcn/ui sonner 组件）
- 文件操作（创建、删除）失败时调用 `toast.error(message)` 提示用户

## 变更范围

### 1. Server 层 — `packages/server/src/routes/content.ts`

新增 `POST /api/content/*` 端点：

body 包含 `action` 字段：

- `action: "mkdir"` — 在指定路径创建目录（`fs.mkdir`，`recursive: true`）
- `action: "touch"` — 在指定路径创建空文件（`fs.writeFile`，内容为 `""`）

路径规则：
- 复用 `path.resolve + startsWith(rootPath)` 校验
- 不允许路径以 `.spherse` 开头
- 目标已存在时返回 `409 Conflict`

### 2. API Client — `packages/app/src/lib/api.ts`

新增 2 个方法：

- `mkdir(dirPath: string)` — `POST /api/content/{dirPath}` body=`{ action: "mkdir" }`
- `touchFile(filePath: string)` — `POST /api/content/{filePath}` body=`{ action: "touch" }`

### 3. FileTree 组件 — `packages/app/src/components/FileTree.tsx`

#### 右键菜单扩展

**文件夹节点**菜单项：
1. 「新建文件」→ 弹出内联 input，输入文件名后在该文件夹下创建空文件
2. 「新建文件夹」→ 弹出内联 input，输入名称后在该文件夹下创建子文件夹
3. 「删除」（已有）

**文件节点**菜单项不变（仅「删除」）。

#### 内联输入组件

- 在树节点下方显示 `<input>`，自动聚焦
- 回车确认操作，Esc 取消并关闭输入框
- 空输入时忽略，不发送请求
- 前端校验名称不能包含 `/`、`\`、`:`、空字符串
- 操作成功后手动调用 `refreshExpanded` 刷新文件树

#### 状态管理

新增状态追踪当前正在创建的节点和操作类型：

```
creatingState: { parentPath: string; action: "new-file" | "new-folder" } | null
```

通过 props 将操作回调从 `FileTree` 传递到 `TreeNodeView`。

### 4. Toast 基础设施

- 安装 `sonner` 依赖
- 创建 `packages/app/src/components/ui/sonner.tsx`（导出 `<Toaster />` 组件，配置主题和 CSS 变量对齐）
- 在 App 根组件（渲染路由的位置）添加 `<Toaster />`
- FileTree 中所有文件操作（创建、删除）的 catch 分支改为 `toast.error(message)` 替代 `console.error`

### 5. ProjectPage 联动

新建操作不影响当前视图，无需额外联动。
