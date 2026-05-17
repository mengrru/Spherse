# Tool Call Path 可点击跳转

## 概述

在 chat 界面的 tool call 展开区域中，将 `path` / `file_path` 参数渲染为可点击链接，点击后跳转到 ContentBrowser 查看对应文件。

## 涉及工具

仅对以下工具的 `path` 或 `file_path` 参数生效：

- `read_file` — `path`
- `write_file` — `path`
- `edit_file` — `path`
- `list_files` — `path`（目录路径）
- `search_content` — `path`（目录路径，可选参数）
- `render_card` — `file_path`（可选参数）

## 交互行为

- **折叠状态**：摘要行不变，path 不可点击
- **展开状态**：`path` / `file_path` 参数值渲染为可点击链接，点击后切换到 ContentBrowser 查看该文件
- **返回**：使用 ContentBrowser 已有的返回按钮回到 chat 视图

## 技术方案

采用回调透传（方案 A）：`onNavigateToPath` 回调从 ProjectPage → ChatPage → ToolCallSection 逐层传递。

### 改动文件

1. **`packages/app/src/components/ToolCallSection.tsx`**
   - Props 新增 `onNavigateToPath?: (path: string) => void`
   - 展开状态的参数表格中，当 key 为 `path` 或 `file_path` 且 `onNavigateToPath` 存在时，将值渲染为可点击链接
   - 链接样式：`text-[var(--accent)] underline hover:opacity-80`

2. **`packages/app/src/pages/ChatPage.tsx`**
   - Props 新增 `onNavigateToPath?: (path: string) => void`
   - 透传给 `<ToolCallSection onNavigateToPath={onNavigateToPath} />`

3. **`packages/app/src/pages/ProjectPage.tsx`**
   - `<ChatPage>` 调用处新增 `onNavigateToPath={handleSelectFile}`

### 不变的部分

- 折叠状态的摘要行渲染逻辑不变
- 其他参数的渲染不变
- ContentBrowser 返回逻辑不变
- 数据流和 WebSocket 事件处理不变
