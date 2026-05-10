# HTML 文件预览功能设计

## 目标

在 ContentBrowser 中为 `.html` / `.htm` 文件提供两种视图：**预览**（默认）和**源码**。预览视图通过 iframe 渲染 HTML，支持加载本地引用资源（CSS、图片、JS 等）。视图切换按钮在 header 右上角。

## 方案：Server 静态文件路由

### Server 端

新增 `packages/server/src/routes/preview.ts`，注册路由 `GET /api/preview/*`：

- 将通配路径映射到 `projectRoot` 下的真实文件
- 做与 `content.ts` 相同的 `path.resolve + startsWith` 路径穿越校验
- 根据文件扩展名设置 Content-Type（html → text/html, css → text/css, js → application/javascript, png → image/png 等）
- 对于不支持的文件类型返回 403
- 仅允许白名单扩展名：html, htm, css, js, json, png, jpg, jpeg, gif, svg, ico, webp, woff, woff2, ttf, eot, mp3, mp4, webm
- 在 `routes/index.ts` 中注册该路由

### 前端

修改 `packages/app/src/pages/ContentBrowser.tsx`：

- 新增 `isHtml` 检测（`.html` / `.htm`）
- 新增 `htmlViewMode` 状态：`"preview"` | `"source"`，默认 `"preview"`
- **预览视图**：`<iframe src="/api/preview/{filePath}" />`，占满内容区域（w-full h-full border-0）
- **源码视图**：保持现有 `<pre>` 渲染
- Header 右上角增加切换按钮组：`[预览 | 源码]`，仅 HTML 文件时显示
- `ApiClient` 新增 `getPreviewUrl(filePath)` 方法，返回拼接好的预览 URL，供 iframe src 使用

### 安全考虑

- 路径穿越校验与现有 `content.ts` 一致
- 文件扩展名白名单限制可访问的文件类型
- iframe 不需要 sandbox，因为本地文件可信
