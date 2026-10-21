# 不支持预览的文件：占位卡「下载」按钮

## 背景

Content Browser 对不支持预览的二进制文件（PDF / Word / zip 等）只显示 `UnsupportedFileCard` 占位卡，桌面端有「用默认应用打开」（`capabilities.openFileExternal` 门控），web/移动端没有任何取回文件的能力。本任务为占位卡增加「下载」按钮：

- 桌面端：弹出系统保存对话框，把文件另存到用户指定位置；
- web/移动端：通过浏览器真实下载语义（`<a download>` + blob）保存到本地；
- 保留「用默认应用打开」的现有能力门控不变；
- 主视图、分窗只读视图、浮窗共用同一卡片组件，行为天然一致。

## 现状与可复用件（调研结论）

| 件 | 现状 |
|---|---|
| 卡片组件 | `packages/app/src/features/content-browser/UnsupportedFileCard.tsx`，三视图（主 / 分窗只读 / 浮窗）都经 `ContentView` binary 分支复用 |
| 服务端流式文件端点 | 仅 `GET /api/projects/:id/preview/*`，31 种扩展名白名单（安全边界，见 `docs/official/architecture/server.md`），pdf/docx/zip/bin 等 403 |
| 通用 raw 下载端点 | **不存在**，需要新增（Content-Disposition / octet-stream 均无先例） |
| web 保存能力 | `HostBridge.saveBlob?`，web 已实现（`<a download>` + objectURL，`packages/web/src/host-bridge-web.tsx:201-210`） |
| 桌面保存对话框 | `show-save-dialog` IPC 已存在（`packages/desktop/electron/ipc/project.ts:204-212`） |
| 桌面本地打开 | `open-file` IPC，main 用 `isInsideAnyOpenProject` 校验（`ipc/project.ts:166-172`），renderer 用 `joinPath(projectRoot, filePath)` 拼绝对路径 |
| fetch→blob→saveBlob 降级先例 | `packages/app/src/features/chat/ImageCard.tsx:20-62`、`HtmlCard.tsx`、`save-export-degradation.test.tsx` |
| 鉴权 | 全局 auth hook 覆盖 `/api/`，Bearer / query token；apiClient `authedFetch` 已封装 Bearer |
| 路径安全 | `serverAccessPolicy(root).assertRead`（内含 `resolveProjectPath` 穿越防护）+ 分类白名单 SRV_READ，preview/content 均用此双层。**注意**：`categorizePath` 对未命中 `.spherse` 模式的路径兜底 `userFiles`（`path-category.ts:66-71`），SRV_READ 放行 `userFiles`——即 `.git/**`、`node_modules/**` 并不被 access policy 拒绝，现状仅靠 preview 扩展名白名单与文件树过滤（`fs-walk.ts:2`）挡住 |

## 设计

### D1 服务端：新增 `GET /api/projects/:projectId/download/*`

新文件 `packages/server/src/routes/download.ts`，在 `routes/index.ts` 注册。处理顺序与 preview 一致，外加一条显式段过滤：

1. `serverAccessPolicy(root).assertRead(relativePath)` —— 内部先 `resolveProjectPath` 拒绝 `../` 穿越，再按 SRV_READ 分类拒绝受保护路径（如 `.spherse/sessions.db`）。**与 content API 读取同一策略，不为下载扩大文件访问白名单**；
2. **显式拒绝 `.git` / `node_modules` 路径段**：`relativePath` 任一路径段为 `.git` 或 `node_modules` → 403。对齐 server 层 fs-watcher 的既有过滤语义（`packages/server/src/bus/fs-watcher.ts:17`，`segs.includes(".git") || segs.includes("node_modules")`）。原因：这些路径被 `categorizePath` 兜底为 `userFiles` 而 SRV_READ 放行，现状其二进制内容不可经任何端点取回（preview 白名单挡、content binary 嗅探只返回 `binary:true`），无此过滤则 download 端点会扩大远程（tunnel/mobile）可取回的文件集合，违反「不为下载扩大文件访问白名单」。**不**一刀切拒绝全部 dotfile（SRV_READ 刻意放行 `.spherse/attachments|skills` 等）；
3. `fs.stat`：不存在或为目录 → 404；
4. 响应：
   - `Content-Type: application/octet-stream`
   - `Content-Disposition: attachment; filename="<ascii-fallback>"; filename*=UTF-8''<pct-encoded>`（RFC 5987；ascii-fallback 将非 ASCII 与控制字符（含 CR/LF，防 header 注入）替换为 `_`、转义 `"`，保证中文/空格/特殊字符文件名正确）
   - `Content-Length: stat.size`
   - body：`createReadStream(absolutePath)` 流式，不整体读入内存。

**Content-Length 取舍**：stat 与 stream 之间存在文件被写长/截断的 TOCTOU 竞态（preview 全文件路径不设 Content-Length、走 chunked，无此模式）。接受该竞态：下载场景浏览器需要总长度显示进度；出错表现为响应长度不符、连接中断，浏览器报下载失败，不落盘错乱字节。

**不做扩展名白名单**（与 preview 的关键差异，需要说明）：preview 白名单是「内联展示」安全边界——浏览器直接渲染响应（HTML/XSS、SVG script 等），所以必须限定类型。download 端点强制 `attachment` + `octet-stream`，浏览器只落盘不解释执行，攻击面是「用户主动保存再打开」，与「用默认应用打开」（桌面已有能力，本地直接打开任意项目文件）同级。访问控制完全依赖同一 access policy，未扩大可读文件集合。

无 JSON wire schema（二进制流响应），不加 contracts schema；错误响应沿用现有 `HttpError`（403/404 JSON）。

鉴权：无新增——desktop renderer 走 apiClient Bearer fetch；auth hook 已拦截 `/api/`。**不为下载新增 `__auth` 路径 token 形态**（无 iframe/img 嵌入场景），token 不进 URL。

### D2 桌面端：`download-file` IPC（另存为，零 HTTP）

桌面端文件本就在本机磁盘，下载语义 = 另存一份到用户指定位置，走 IPC 直接复制，不经过 HTTP 与 renderer 内存：

- preload（`packages/desktop/electron/preload.ts`）：`downloadFile: (filePath) => ipcRenderer.invoke("download-file", filePath)`；`electron/types.ts` 的 `ElectronAPI` 同步加签名；
- main（`ipc/project.ts` 新 handler）：
  1. 参数为非空 string，否则忽略；
  2. `isInsideAnyOpenProject(filePath, getOpenProjects()...)` 校验源路径在任一 open project 内（复用 `open-file` 的校验函数；与 open-file 的静默 return 不同，校验失败 **throw**，让 renderer 有失败反馈）；
  3. `dialog.showSaveDialog(win, { defaultPath: path.basename(source) })`；**E2E seam**：env `SPHERSE_E2E_SAVE_DIALOG_PATH` 非空时直接作为目标路径（沿用 `SPHERSE_E2E_SELECT_DIRECTORY` 先例，`ipc/project.ts:116`）；
  4. 用户取消（canceled / 无窗口）→ 正常返回，**不报失败**；
  5. `fs.promises.copyFile(resolve(source), target)`（Node 内部流式复制）；源文件被删等 IO 错误 → throw，renderer toast。Windows 下 renderer 传入的混合分隔符路径（`joinPath` 以 `/` 连接）由 `path.resolve` 归一，与 open-file 完全同路径，无额外处理。
- `packages/desktop/src/host-bridge-electron.ts`：`project.downloadFile = api.downloadFile`。

### D3 Bridge 契约：`ProjectHostApi.downloadFile?` 可选方法

`packages/app/src/lib/host-bridge.ts`：

```ts
interface ProjectHostApi {
  ...
  downloadFile?(absolutePath: string): Promise<void>;
}
```

可选方法 + 存在性门控，与 `saveBlob?` / `showSaveDialog?` 惯例一致。**不改 `HostCapabilities`**（字段被 `host-capabilities.structure.test.ts` 钉死，且「能否下载」可用方法存在性表达，无需新能力字段）。web bridge 不实现该方法。

### D4 apiClient：`downloadFile(filePath): Promise<Blob>`

`packages/app/src/lib/api.ts`：

```ts
async downloadFile(filePath: string): Promise<Blob> {
  const res = await authedFetch(`${apiBase}/download/${encodePath(filePath)}`);
  if (!res.ok) { /* 解析 {error} JSON → throw ApiError，同 assertOk */ }
  return res.blob();
}
```

路径编码用逐段 `encodeURIComponent`（提取 `getPreviewUrl` 的 `api.ts:534-538` 惯例为共享 helper，含 `/` 的文件名段被正确编码且 Fastify 解码 params 后还原）。Bearer header 经 `authedFetch`，token 不进 URL。`!res.ok` 时解析错误 JSON 抛 `ApiError`，组件据此 toast——保证**不把 JSON 错误响应当文件保存**。

### D5 UnsupportedFileCard：下载按钮

- 门控：`bridge.project?.downloadFile ?? bridge.saveBlob` 存在即显示（desktop 走前者，web 走后者；两者都缺失的宿主不显示）。「用默认应用打开」按钮与 `capabilities.openFileExternal` 门控原样保留，两按钮并排；
- 处理逻辑：
  - 桌面：`await bridge.project.downloadFile(joinPath(projectRoot, filePath))`（绝对路径拼接复用现有 `joinPath`）；取消 = 正常 resolve，无 toast；失败 toast；
  - web：`const blob = await client.downloadFile(filePath)` → `await bridge.saveBlob(fileName, blob)`；`fileName = basename(filePath)`（原始未编码名，blob URL 同源 `a[download]` 生效）；网络失败 / HTTP 错误 → toast `下载失败：{message}`；`useApiClient` 在 projectId 非空时恒返回非 null client（`use-connection.ts:8-15`），无需专门的未连接分支，错误路径兜底；
  - 下载进行中按钮 loading（spinner + disabled），防重复点击；
- 只读视图（分窗）/浮窗无额外门控：与「本地打开」一致，下载不受只读限制，也不绕过后端权限（web 走鉴权 API，桌面走 open-project 校验）。

### D6 i18n

新增 2 个 key（三语同步，zh-CN 带场景注释）：

- `content-browser.unsupported.download`：「下载」/ "Download" / 「下載」
- `content-browser.unsupported.downloadFailed`：「下载失败：{message}」

## 各文件改动清单

| 文件 | 改动 |
|---|---|
| `packages/server/src/routes/download.ts` | 新增端点 |
| `packages/server/src/routes/index.ts` | 注册 |
| `packages/app/src/lib/api.ts` | `downloadFile` 方法 |
| `packages/app/src/lib/host-bridge.ts` | `ProjectHostApi.downloadFile?` |
| `packages/app/src/features/content-browser/UnsupportedFileCard.tsx` | 下载按钮 + 逻辑 |
| `packages/desktop/electron/preload.ts` / `types.ts` | `downloadFile` 暴露 |
| `packages/desktop/electron/ipc/project.ts` | `download-file` handler + seam |
| `packages/desktop/src/host-bridge-electron.ts` | 接线 |
| `packages/i18n/src/locales/{zh-CN,en,zh-TW}.ts` | 两 key 三语 |
| 测试 | 见下节 |

## 测试

| 层 | 文件 | 用例 |
|---|---|---|
| server 契约 | `packages/server/src/__tests__/download.test.ts`（新） | ① 200：原始字节一致、`octet-stream`、`Content-Disposition`（含中文/空格文件名的 `filename*` 编码）、`Content-Length` ② 白名单外扩展（.pdf/.zip/.bin）可下载（对比 preview 403）③ 404：不存在 / 目录 ④ 403：`../` 穿越、SRV_READ 拒绝的受保护路径（`.spherse/sessions.db`）、`.git` / `node_modules` 段（嵌套层也要拒）⑤ 流式（以 Content-Length + body 完整性表达） |
| app 组件 | `UnsupportedFileCard.test.tsx` 扩展 | ① web bridge：显示下载按钮（无打开按钮）→ 点击 → `client.downloadFile(相对路径)` → `saveBlob(文件名, blob)` ② API 失败 → toast error、不调 saveBlob ③ desktop bridge（`project.downloadFile`）→ 点击调用绝对路径、不 fetch ④ desktop `downloadFile` reject → toast error ⑤ 无任何下载能力 → 不显示按钮 ⑥ 现有「用默认应用打开」用例保留不回归 |
| desktop IPC 单测 | `electron/ipc/project.test.ts` 扩展（需改造现有 mock 基建：`isInsideAnyOpenProject` 由固定 `() => false` 改为可配置，`dialogMock` 增补 `showSaveDialog`，copy 用真实临时目录断言内容） | ① 源路径不在 open project 内 → reject ② dialog 取消 → resolve 且不 copy ③ seam 路径 → copy 到 seam 目标，内容一致 ④ copy 源缺失 → reject |
| E2E | `packages/desktop/e2e/unsupported-file-download.spec.ts`（新） | 建项目 + 写 `.bin` 文件（**内容必须含 NUL 字节**，否则 content API 二进制嗅探不判定 binary、卡片不出现）→ 直跳 content 路由 → 卡片同时有「下载」与「用默认应用打开」→ `SPHERSE_E2E_SAVE_DIALOG_PATH` 指定目标 → 点下载 → 目标文件字节与源一致 |

## 文档同步

- `docs/official/architecture/server.md`：download 端点（与 preview 白名单的关系、为何无扩展名白名单）
- `docs/official/project-structure.md`：新文件
- i18n 三语 catalog
- 本 design doc

## 已知边界与风险

- **web/移动端内存**：浏览器端 blob 下载会把文件整体读入内存（平台限制；Chrome 对大 blob 有磁盘缓冲，iOS Safari 较弱）。文档中如实说明；桌面端零 renderer 内存（fs 复制）。此为 ImageCard 等 chat 下载已有的一致行为，不引入新机制；
- **symlink**：跟随 `resolveProjectPath` / access policy 现状（与 preview/content 一致），不为下载单独扩大或收紧；
- **断点续传**：download 端点不支持 Range（浏览器下载管理器会从头重试）；preview 的 Range 能力不受影响；
- **「下载受浏览器/平台能力限制」**：web 端保存位置由浏览器决定（通常「下载」目录），与桌面端可选位置不同，属预期平台差异。

## 验证

```bash
npm test --workspace=packages/server
npm test --workspace=packages/app
npm test --workspace=packages/desktop
npm run verify
npm run check:i18n
npm run test:e2e -w @spherse/desktop -- unsupported-file-download
```

## Design review 处理

| 级别 | 意见 | 处理 |
|---|---|---|
| C1 | `.git`/`node_modules` 被 `categorizePath` 兜底为 `userFiles`（SRV_READ 放行），无白名单端点会扩大远程可取回集合；原设计对 SRV_READ 的描述有误 | 已修：D1 增加显式段过滤（对齐 fs-watcher 语义），现状表与测试④同步改写（受保护路径示例改为 `.spherse/sessions.db`） |
| I1 | E2E/测试的 `.bin` 内容必须含 NUL 字节，否则不触发 binary 嗅探、卡片不出现 | 已修：E2E 用例注明 |
| I2 | desktop 失败反馈缺组件用例；现有 IPC 测试 mock 基建需改造（isInsideAnyOpenProject 固定 false、无 showSaveDialog） | 已修：组件测试补 ④，IPC 单测注明 mock 基建改造 |
| M1 | `Content-Length` 引入 stat/stream 间 TOCTOU，未注明取舍 | 已修：D1 注明接受竞态及失败表现 |
| M2 | `encodePath` 未指定语义 | 已修：指定逐段 encodeURIComponent（getPreviewUrl 惯例） |
| M3 | 「复用 open-file 先例 throw」与 open-file 实际静默 return 不一致 | 已修：D2 改为「复用校验函数，行为改为 throw」 |
| m1-m5 | i18n key 数目笔误、check:i18n 脚本位置、ascii fallback 控制字符、Windows 分隔符、未连接分支 | 已修：分别更正/注明；m5 简化为错误路径兜底 |
