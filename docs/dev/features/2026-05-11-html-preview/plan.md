# HTML 文件预览 实现计划

**Goal:** 为 ContentBrowser 中的 HTML 文件提供预览/源码双视图，默认预览，右上角切换。

**Architecture:** Server 新增静态文件预览路由 `GET /api/preview/*`，将路径映射到项目目录真实文件并返回正确 Content-Type。前端 ContentBrowser 检测 HTML 后缀，用 iframe 加载预览 URL，支持预览/源码切换。

**Tech Stack:** Fastify（server 路由）、React（前端组件）、iframe（HTML 渲染）

---

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `packages/server/src/routes/preview.ts` | 预览静态文件路由 |
| 修改 | `packages/server/src/routes/index.ts` | 注册预览路由 |
| 修改 | `packages/app/src/lib/api.ts` | 新增 `getPreviewUrl` 方法 |
| 修改 | `packages/app/src/pages/ContentBrowser.tsx` | HTML 双视图 + 切换按钮 |

---

### Task 1: Server 预览路由

**新建:** `packages/server/src/routes/preview.ts`

导出 `registerPreviewRoutes(fastify, ctx): void`，注册 `GET /api/preview/*`：

- 路径解析与校验逻辑复用 `content.ts` 的模式：`path.resolve(projectRoot, relativePath)` + `startsWith` 校验
- 扩展名白名单 map（ext → Content-Type），不在白名单的返回 403
- 白名单：`html`→`text/html`, `htm`→`text/html`, `css`→`text/css`, `js`→`application/javascript`, `json`→`application/json`, `png`→`image/png`, `jpg`/`jpeg`→`image/jpeg`, `gif`→`image/gif`, `svg`→`image/svg+xml`, `ico`→`image/x-icon`, `webp`→`image/webp`, `woff`→`font/woff`, `woff2`→`font/woff2`, `ttf`→`font/ttf`, `eot`→`application/vnd.ms-fontobject`
- 用 `fs.readFile` 读取文件，`reply.type(contentType).send(buffer)` 返回
- 错误处理：403（路径穿越 / 扩展名不允许）、404（文件不存在）

**修改:** `packages/server/src/routes/index.ts`

- import `registerPreviewRoutes`
- 在 `registerAllRoutes` 中调用 `registerPreviewRoutes(fastify, ctx)`

- [ ] 实现 preview.ts 并注册路由
- [ ] `npm run build --workspace=packages/server` 验证编译通过
- [ ] 启动 server，手动请求 `GET /api/preview/test.html` 验证返回正确 Content-Type

---

### Task 2: ApiClient 新增 getPreviewUrl

**修改:** `packages/app/src/lib/api.ts`

在 return 对象中新增：

```ts
getPreviewUrl(filePath: string): string {
  return `${baseUrl}/api/preview/${filePath}`;
}
```

- [ ] 新增方法，编译验证通过

---

### Task 3: ContentBrowser HTML 双视图

**修改:** `packages/app/src/pages/ContentBrowser.tsx`

接口变更：

- props 新增无需改动（client 已有）
- 新增 state：`const [htmlView, setHtmlView] = useState<"preview" | "source">("preview")`
- 新增检测：`const isHtml = filePath.endsWith(".html") || filePath.endsWith(".htm")`

Header 区域改动（现有 `flex items-center` 的 div）：

- 在文件路径 `<span>` 之后，条件渲染 `{isHtml && ...}` 切换按钮组
- 按钮组样式：两个按钮并排，当前激活态用 `bg-accent` 或类似高亮
- 点击切换 `htmlView` 状态

内容区域改动：

- 当 `isHtml && htmlView === "preview"` 时：渲染 `<iframe src={client.getPreviewUrl(filePath)} className="w-full h-full border-0" />`
- 当 `isHtml && htmlView === "source"` 时：保持现有 `<pre>` 渲染
- 非 HTML 文件不受影响

注意：预览模式下 iframe 的容器需要去掉 `p-4` padding，让 iframe 完全占满；源码模式保持原有 padding。

- [ ] 实现双视图逻辑和切换 UI
- [ ] `npm run build --workspace=packages/app` 验证编译通过
- [ ] 启动应用，点击 HTML 文件验证预览和切换功能

---

### Task 4: 端到端验证

- [ ] 在项目中放置一个引用本地 CSS/图片的 HTML 测试文件
- [ ] 启动完整应用（`npm run dev`），验证预览加载资源正常
- [ ] 验证切换到源码视图显示原始文本
- [ ] 验证非 HTML 文件不受影响
- [ ] 更新 `docs/dev/backlog.md` 中对应条目状态为 `[x]`
