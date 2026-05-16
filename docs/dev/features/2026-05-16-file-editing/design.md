# 文件编辑功能设计

## 目标

在应用内的 ContentBrowser 中为 Markdown 和纯文本文件提供轻量编辑能力，让用户在查看文件时能快速微调内容，无需切换到外部编辑器。

## 定位

轻量查看 + 微调，不是主力编辑器。用户主要在应用内查看文件内容，偶尔修改文字，做小幅调整。

## 涉及范围

### 文件类型

- **可编辑**：Markdown（`.md`, `.markdown`, `.agents.md`）、纯文本文件（`.yaml`, `.yml`, `.txt` 等）
- **不可编辑**：HTML 文件（保持现有预览/源码切换模式）
- **编辑方式**：源码编辑（Markdown 编辑时显示原始 Markdown 源码）

### 不涉及

- 文件创建/删除（backlog 中独立条目）
- 版本控制/撤销历史
- 多 tab 编辑
- 协作编辑
- 富文本/所见即所得编辑
- 语法高亮/行号（使用原生 textarea）

## 架构

三层各司其职，不改动 core 层：

```
[ContentBrowser (前端)]  ←→  [PUT /api/content/* (server)]  ←→  [fs.writeFile (Node.js)]
```

- **前端**（`packages/app/src/pages/ContentBrowser.tsx`）：新增编辑模式状态，原生 `<textarea>` 渲染源码，管理 dirty 状态和保存逻辑
- **Server**（`packages/server/src/routes/content.ts`）：新增 `PUT /api/content/*` 路由
- **API Client**（`packages/app/src/lib/api.ts`）：新增 `saveContent()` 方法

## Server API

### 新增路由

```
PUT /api/content/{relativePath}
Body: { "content": string }
```

**响应**：
- `200` `{ "ok": true }` — 写入成功
- `403` `{ "error": "Access denied" }` — 路径穿越校验失败
- `500` `{ "error": "Write failed: ..." }` — 写入失败

**行为**：
- 复用现有路径安全校验（`path.resolve` + `startsWith`）
- 自动创建不存在的父目录（`fs.mkdir({ recursive: true })`）
- 使用 `fs.writeFile` 写入 UTF-8 文本

## 前端 UX

### 工具栏扩展

在现有工具栏（返回按钮 + 文件路径）右侧增加操作按钮：

- **查看模式（Markdown/文本）**：显示"编辑"按钮
- **编辑模式**：显示"保存"按钮（主操作）+ "取消"按钮
- **HTML 文件**：保持现有预览/源码切换，不显示编辑按钮

### 编辑模式

1. 点击"编辑"→ 从查看模式切换到 `<textarea>` 显示源码
2. `<textarea>` 样式：`font-mono text-sm`，与当前 `<pre>` 查看风格一致
3. dirty 指示器：文件名旁显示小圆点（`●`）表示有未保存修改
4. Ctrl+S / Cmd+S 快捷键保存
5. 编辑模式下点击"取消"→ 放弃编辑回到查看模式

### 冲突处理

编辑模式下，通过 fs-watch WebSocket 检测到当前文件被外部修改时：

1. 显示冲突提示条，选项：
   - "保留我的修改" — 忽略外部变更，继续编辑
   - "重新加载文件" — 丢弃未保存编辑，加载最新内容
2. 非编辑模式下行为不变（自动重新加载）

### 离开确认

有未保存修改时点击"返回"按钮 → 弹出确认（"有未保存的修改，确定离开？"），确认后丢弃未保存编辑。

切换到其他文件时（`filePath` prop 变化）不拦截，因为 ContentBrowser 会重新加载新文件内容，未保存编辑自然丢弃。如果用户切换回同一文件，也会重新从磁盘加载最新内容。

## 状态管理

全部在 `ContentBrowser.tsx` 组件内部管理，不需要全局状态：

| 状态 | 类型 | 说明 |
|------|------|------|
| `isEditing` | `boolean` | 是否处于编辑模式 |
| `editedContent` | `string` | 编辑中的内容 |
| `saving` | `boolean` | 保存中（禁用按钮） |
| `conflict` | `boolean` | 检测到外部冲突 |
| `showLeaveConfirm` | `boolean` | 显示离开确认弹窗 |

**dirty 判断**：`editedContent !== content`（简单字符串比较）

## 错误处理

- 保存失败（网络/权限）→ 页面内错误提示，保留编辑内容不丢失
- 文件读取失败 → 保持现有错误展示逻辑

## 修改文件清单

| 文件 | 变更 |
|------|------|
| `packages/server/src/routes/content.ts` | 新增 `PUT /api/content/*` 路由 |
| `packages/app/src/lib/api.ts` | 新增 `saveContent()` 方法 |
| `packages/app/src/pages/ContentBrowser.tsx` | 添加编辑模式、保存逻辑、冲突检测、离开确认 |
