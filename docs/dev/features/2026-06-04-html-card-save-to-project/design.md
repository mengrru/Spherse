# HTML Card 一键保存到项目

## 概述

在 HTML Card 右上角增加保存图标按钮，点击后弹出系统原生文件保存对话框（默认定位到项目目录），用户选择路径后将 card HTML 内容保存为文件，保存成功后 toast 提示。

## 背景

HTML Card 是 agent 通过 `render_card` tool 在聊天流中渲染的富内容卡片（如网页、图表、样式文档）。当前 card 仅支持查看，用户无法将 card 内容保存为项目文件。用户常有将 agent 生成的 HTML 内容持久化到项目中的需求。

## 需求

1. 在 HtmlCard 右上角显示保存图标
2. 点击图标弹出系统原生保存对话框（Electron `dialog.showSaveDialog`）
3. 对话框默认定位到项目目录，默认文件名使用 `card.title`
4. 保存范围限制在项目目录内（超出则 toast 报错）
5. 保存成功后 toast 提示
6. 不修改 `render_card` tool 和 `HtmlCard` 类型定义

## 技术方案

### 方案选择

**方案 A：Electron 原生保存对话框 + 后验证**（已选定）

利用 Electron `dialog.showSaveDialog` 弹出系统原生保存对话框，`defaultPath` 设为项目根目录。用户选择路径后，前端校验路径是否在项目目录内，通过则调用现有 Content API 写入。

对比方案：
- 方案 B（应用内自定义对话框）：不依赖 Electron IPC，但不符合"系统文件保存窗口"需求
- 方案 C（无弹窗直接保存）：最简单，但用户无法选择路径和文件名，有同名覆盖风险

### 数据流

```
用户点击保存图标
  → 前端调用 IPC showSaveDialog({ defaultPath, suggestedName })
  → Electron main process 调用 dialog.showSaveDialog
  → 返回 filePath（或 null = 用户取消）
  → 前端校验 filePath 在 projectRoot 下
  → 调用 client.saveContent(relativePath, card.html)
  → PUT /api/content/{relativePath}
  → Server 写入文件（path 安全校验 + mutex）
  → toast.success / toast.error
```

### 1. Electron IPC 扩展

#### preload.ts

新增 `showSaveDialog` bridge：

```ts
showSaveDialog: (options: { defaultPath?: string }) =>
  ipcRenderer.invoke("show-save-dialog", options),
```

#### ipc/project.ts

新增 handler：

```ts
ipcMain.handle("show-save-dialog", async (event, options: { defaultPath?: string }) => {
  const win = getWindow();
  if (!win) return null;
  const result = await dialog.showSaveDialog(win, {
    defaultPath: options.defaultPath,
    filters: [{ name: "HTML", extensions: ["html", "htm"] }],
  });
  return result.canceled ? null : result.filePath;
});
```

### 2. HtmlCardRenderer 组件改造

**文件**：`packages/app/src/features/chat/HtmlCard.tsx`

在组件右上角增加保存按钮（lucide `Download` 图标）。

**布局策略**：
- 有 title bar 时：图标放在 title bar 右侧（flex 布局，title 左对齐，图标右对齐）
- 无 title bar 时：在 card 容器右上角放一个浮动图标（hover 时显示，降低视觉干扰）

**上下文获取**：组件通过 `useAppStore` 获取 `projectRoot` 和 `client`。项目中 `AppContext` 是普通接口而非 React Context，因此使用 zustand store 访问：

```ts
const activeProjectKey = useAppStore((s) => s.activeProjectKey);
const ctx = useAppStore((s) => {
  const p = activeProjectKey ? s.projects.get(activeProjectKey) : undefined;
  return p?.ctx;
});
const client = ctx?.client;
const projectRoot = ctx?.projectRoot;
```

`HtmlCardRenderer` 的 props 不变，仍然只接收 `card: HtmlCard`。

**保存逻辑**（renderer 进程无 Node.js `path` 模块，使用字符串操作）：

```ts
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:\*\?"<>\|]/g, "_").trim() || "untitled";
}

async function handleSave() {
  const suggestedName = card.title
    ? sanitizeFileName(card.title) + ".html"
    : "untitled.html";
  const defaultPath = projectRoot + "/" + suggestedName;

  const filePath = await window.electronAPI.showSaveDialog({ defaultPath });
  if (!filePath) return;

  // 前端路径校验：dialog 返回的已是绝对路径
  if (!filePath.startsWith(projectRoot + "/") && filePath !== projectRoot) {
    toast.error("文件必须保存在项目目录内");
    return;
  }

  const relativePath = filePath.slice(projectRoot.length + 1);
  try {
    await client.saveContent(relativePath, card.html);
    toast.success("保存成功");
  } catch (err) {
    toast.error(`保存失败：${(err as Error).message}`);
  }
}
```

### 3. 路径安全

两层校验：
1. **前端校验**：`filePath.startsWith(projectRoot + "/")` — 快速拒绝明显越界的路径
2. **服务端校验**：`PUT /api/content/*` 已有 `path.resolve + startsWith` 校验 — 兜底保障

### 4. 文件名清理

`card.title` 可能包含不合法文件名字符，已在 `handleSave` 中通过 `sanitizeFileName` 处理。清理逻辑定义在 `HtmlCard.tsx` 内部，不单独导出。

### 5. 涉及文件清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `packages/app/electron/preload.ts` | 新增 `showSaveDialog` IPC bridge |
| 修改 | `packages/app/electron/ipc/project.ts` | 新增 `show-save-dialog` handler |
| 修改 | `packages/app/src/features/chat/HtmlCard.tsx` | 增加保存按钮和保存逻辑 |

### 6. 不涉及的改动

- `packages/core` — 无需修改，`render_card` tool 不变
- `packages/server` — 无需修改，复用现有 Content API
- `HtmlCard` 类型定义 — 不变
- `MessageItem` / `useChatSession` — card 数据流不变

### 7. 测试策略

- **手动测试**：在桌面应用中渲染 HTML Card，验证保存流程
  - 有 title 的 card → 默认文件名为 title
  - 无 title 的 card → 默认文件名为 "untitled.html"
  - 选择项目外路径 → toast 报错
  - 保存成功 → toast 提示，文件内容正确
  - 用户取消 → 无任何副作用
  - 特殊字符 title → 文件名被正确清理
