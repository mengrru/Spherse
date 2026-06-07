# Content Browser 图片浏览

日期：2026-06-07

## 背景

Content Browser 目前支持 Markdown 渲染、HTML 预览/源码、纯文本查看和内联编辑。当用户在文件树中点击图片文件时，content API 以 UTF-8 读取二进制文件，导致乱码或报错。需要让图片文件也能正常查看。

## 目标

在文件树中点击图片文件后，Content Browser 以居中自适应方式展示图片，不支持编辑。

## 支持格式

png、jpg/jpeg、gif、svg、webp（与现有 preview API 已支持的格式一致，不含 ico）。

## 设计

### 文件类型检测（index.tsx）

新增 `isImage` 判断，与现有 `isMarkdown` / `isHtml` 同级：

```ts
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"]);
const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
const isImage = IMAGE_EXTENSIONS.has(ext);
```

- `isEditable = !isHtml && !isImage`：图片文件不显示 Edit 按钮
- 图片文件不调用 `useContentFile`（content API 读 UTF-8 对二进制文件无意义），图片通过 preview URL 加载

### ContentView 渲染（ContentView.tsx）

在渲染优先级中新增图片分支：

```
1. HTML preview（iframe） — isHtml && htmlView === "preview"
2. 图片查看 — isImage
3. 编辑模式（Textarea） — isEditing
4. 默认内容 — Markdown / 纯文本
```

图片渲染：

```tsx
if (isImage && !loading && !error) {
  return (
    <div className="flex flex-1 items-center justify-center overflow-auto bg-muted p-4">
      <img
        src={client.getPreviewUrl(filePath)}
        alt={filePath}
        className="max-h-full max-w-full rounded-lg object-contain"
      />
    </div>
  );
}
```

- `bg-muted` 背景区分于 Markdown 的 `bg-card`，突出图片内容
- `max-h-full max-w-full object-contain` 居中自适应，保持原始比例不裁剪
- 不需要 loading/error 状态（图片不走 content API，加载由浏览器 `<img>` 原生处理）

Props 变更：`ContentView` 新增 `isImage: boolean`。

### Header 行为

图片文件的 `isEditable = false`，不显示 Edit 按钮。不显示 HTML 的 preview/source 切换。Header 只显示返回按钮 + 文件路径，与纯文本文件未编辑时一致。无需新增逻辑。

### TextSelectionSession

图片内容不参与文本选择。图片渲染分支不使用 `contentRef`，避免 ref 挂在无文本内容的容器上产生无效事件。

### useContentFile 调整

当 `isImage` 为 true 时，`index.tsx` 条件跳过 `useContentFile` 调用。图片分支直接传 `content=null`、`loading=false`、`error=null` 给 ContentView，由图片渲染分支处理。这样 `useContentFile` 内部无需感知文件类型，职责保持单一。

### i18n

不需要新增文案。

### 服务端

不需要修改。preview API 已支持所有目标图片格式的正确 MIME type（`image/png`、`image/jpeg`、`image/gif`、`image/svg+xml`、`image/webp`）。

## 涉及文件

| 文件 | 变更 |
|------|------|
| `packages/app/src/features/content-browser/index.tsx` | 新增 `isImage` 判断，调整 `isEditable`，条件跳过 `useContentFile`，传递 `isImage` 给 ContentView |
| `packages/app/src/features/content-browser/ContentView.tsx` | 新增 `isImage` prop，新增图片渲染分支 |
