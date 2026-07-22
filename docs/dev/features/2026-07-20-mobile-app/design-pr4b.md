# Section 4b：移动端 PWA 完善（PR4b）

> **对应 design：** 本文覆盖 PR4b（PWA 可安装性 + 网络韧性 + 移动端设置 + 打包优化）。基于 PR4a 落地后的现状实现。

## 1. 范围

PR4a 已让 web 端「扫码 → 进入项目 → 聊天」全链路可用（含移动侧栏 drawer、窄屏优化）。PR4b 补齐让 web 端成为**可安装、可离线壳、后台恢复自动刷新**的 PWA：

- PWA manifest + service worker（可安装到主屏、standalone 显示、app shell 离线）
- 后台恢复自动 reload（页面不可见超过阈值后再回来时整体刷新，自然同步项目列表 + 重建 WS，无需手写重连逻辑）
- web chunk 拆分优化

明确推迟（见 backlog「移动端 MobileLayout 打磨 + 移动专属 UI」条目）：移动专属项目列表 UI、移动端设置入口（locale/theme 切换、断开连接）、appearance 本地切换（需 styles.css `[data-theme]` 覆盖 + 同步主题 skill）、bottom-sheet 统一应用到所有 Dialog、HTTP polling 降级（待 iOS 实测）。

## 2. PWA manifest + service worker

### 2.1 vite-plugin-pwa 接入

`packages/web` 新增依赖 `vite-plugin-pwa`。`vite.config.ts` 配置：

- `registerType: "autoUpdate"` + `injectRegister: "inline"`（内联注册脚本，无额外文件）
- `manifest`：name/short_name "Spherse"、display standalone、orientation portrait、background_color/theme_color `#fafafa`（与 light `--sp-background` 一致）、icons（192/512/maskable）
- `includeAssets`：favicon.svg、apple-touch-icon、pwa-192
- `workbox.globPatterns`：`**/*.{js,css,html,svg,png,ico,woff,woff2}`（仅 app shell）
- `workbox.navigateFallback: "index.html"` + `navigateFallbackDenylist: [/^\/api\//, /^\/ws\//, /^\/preview\//]`（不拦截 API/WS/preview，hash router 下 index.html 已 precache）
- `devOptions.enabled: false`（dev 不启用 SW）

### 2.2 图标

从 `packages/desktop/build/spherse-icon.png`（512×512）+ `.svg` 派生到 `packages/web/public/icons/`：

- `pwa-192x192.png` / `pwa-512x512.png`：`sips -z` 缩放
- `apple-touch-icon.png`（180×180）：`sips`
- `maskable-512x512.png`：基于 SVG 源用 `rsvg-convert` 生成，设计内容缩放到 72%（确保落在 maskable safe zone 40% 半径圆内）+ 白色背景满铺
- `favicon.svg`：直接复用 icon SVG

### 2.3 index.html meta

`packages/web/index.html` 补充：viewport 加 `viewport-fit=cover`（适配 safe-area-inset）、`<meta name="theme-color">`（light/dark media 各一）、apple-mobile-web-app-capable / status-bar-style / title、apple-touch-icon link。

构建产物：`dist/manifest.webmanifest` + `dist/sw.js` + `dist/workbox-*.js`，SW 以 `scope: "./"` 注册（适配 GitHub Pages `/web/` 子路径部署）。

## 3. 后台恢复自动 reload

iOS PWA 切后台被系统挂起后，WS 常静默断开、项目列表可能过期。PR4b 用**最简方案**：页面不可见超过阈值（30s）后，用户回到页面时整体 `location.reload()`。reload 自然重建一切——重新拉项目列表（`restoreProjects`）、重新建 WS（`bus-store.init` / `streaming-store.connect`）、重新 init stores，无需手写 `refreshProjects` / `reconnectNow` / `resumeConnections` 等增量同步逻辑。

**前提**：草稿按 session 缓存并跨重启恢复（`Composer` 草稿机制），reload 无状态丢失代价。

### 3.1 实现

`packages/web/src/resume-reload.ts` 的 `setupWebResumeReload()`（由 `packages/web/src/main.tsx` 调用）：

```ts
const RESUME_RELOAD_THRESHOLD_MS = 30_000;
// 记录 hidden 时刻；visible 时若 hidden 时长 >= 阈值则 location.reload()
```

该副作用是 web 专属（移动端后台/恢复场景），放在 web shell 自管理，不污染共享层 `App.tsx`（无需 `bridge.kind` 守卫分支）。

> **注**：`lastOpened` 排序数据由 project list API 提供（另见独立 PR），本 PR 不在 web 端自维护访问时间戳。

## 4. web chunk 拆分优化

`packages/web/vite.config.ts` 的 `build.rollupOptions.output.manualChunks` 用**函数形式**（对象形式会要求列出的包必须是可解析入口，`rehype-highlight` 等未直接依赖会报错）：

```ts
manualChunks(id) {
  if (!id.includes("node_modules")) return;
  if (id.includes("react-markdown") || id.includes("/remark-") || id.includes("/rehype-") 
      || id.includes("/unified") || id.includes("/micromark") || id.includes("/mdast-")) {
    return "vendor-markdown";
  }
  if (id.includes("/react-router") || id.includes("react-dom") || id.includes("/react/")) {
    return "vendor-react";
  }
}
```

效果：单 chunk ~1.4MB → vendor-react ~524KB(gzip 170KB) + vendor-markdown ~166KB(gzip 51KB) + index ~577KB(gzip 161KB)。

## 5. 验收

- `npm run build --workspace=packages/web`：产出 `manifest.webmanifest` + `sw.js` + 拆分的 vendor chunks
- `npm run lint`：0 error
- `npm test --workspace=packages/app`：全绿
- `npm test --workspace=packages/desktop` / `--workspace=packages/i18n`：不回归
- `npm run build:desktop`：桌面端行为不变
- `npm test --workspace=packages/desktop` / `--workspace=packages/i18n`：不回归
- `npm run build:desktop`：桌面端行为不变（共享 app 代码改动对 electron 无副作用）
