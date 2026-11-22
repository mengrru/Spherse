# Design: browser 版资源面方案（P3 前置）

- 日期：2026-11-22
- 状态：reviewed（1C/3I/4M/2m 已处理，见文末记录）
- 关联：`docs/dev/infra/2026-11-21-plugin-runtime-rpc/design.md`（P3 降级定义、D5/D6）；spike 实证：本文 §2；OPFS 约束：`docs/dev/investigation/2026-11-22-browser-matrix/`

## 1. 问题与分界

资源面 URL 型接口（preview HTML 卡片、卡片内相对资源、attachments 图片、theme.css）的消费方是浏览器原生加载器（`iframe.src`/`img.src`），无法走 RPC envelope。**三条连接模式共存**：桌面 localhost HTTP（现状工作）、web 壳→远程 server 跨源（`packages/web` 既有形态，现状工作）、browser 本地 SW 模式（P3 缺口）。P3 出口判据的降级定义只是初版口径，完整形态需要本方案。

**P3 两步走**：初版按降级定义交付（不含 SW）→ 完整形态按本设计。

## 2. Spike 实证（2026-11-22，Chromium headless，dev + build/preview 双模式各 10/10）

| # | 假设 | 结果 |
|---|---|---|
| 1 | SW（module worker）fetch 拦截虚拟前缀 → OPFS 读 → respond | ✅ |
| 2 | 页面/Worker 写 OPFS 与 SW 读 OPFS 同 origin 共享 | ✅ |
| 3 | `iframe.src` 虚拟 URL 渲染 HTML 卡片，卡片内脚本执行 | ✅ |
| 4 | 卡片内相对资源相对解析天然落回同前缀 | ✅ |
| 5 | Range → 206：`getFile().slice()` 即可，无需 SyncAccessHandle | ✅ |
| 6 | HTML transform 在响应侧可行（spike 在 SW 侧验证；产品形态注入位置见 D-R3 修订） | ✅ |
| 7 | MIME 按扩展名映射 | ✅ |
| 8 | 未知路径 404；非虚拟前缀 passthrough | ✅ |
| 9 | 生产构建：SW 独立 rollup 入口 + 固定输出名 | ✅ |

demo：临时区 `sw-spike/`。注意：spike 断言 #6 是可行性验证，**不能按原样产品化**（见 M4）。

## 3. 决策

### D-R1：虚拟路由复用桌面 REST 路径形态

SW 拦截路径 = 桌面资源面现路径（`/api/projects/:id/preview/*` 及其保留路由）。收益：app 侧 URL 生成跨端仅差 origin；`__spherse-sdk.js` 保留文件名路由（`preview.ts:89-97`）同样被 SW 承接（D-R3）。

### D-R2：resolveResource 收口点（修订：完整清单）

现散落点全部收口到 `resolveResource(kind, projectId, path)`：

| 现状拼 URL 点 | 位置 |
|---|---|
| `getPreviewUrl` HTTP 实现 | `app/src/lib/api.ts:548-553`（含 `__auth/:token` + `?v=` cache-bust） |
| `getPreviewUrl` RPC 适配实现 | `app/src/lib/api-adapter.ts:401-408` |
| agent theme | `useAgentTheme.ts:41`（已走 getPreviewUrl） |
| **全局 theme 自拼 URL** | `useCustomTheme.ts:7-10`（自带 `__auth` + `?t=Date.now()`，散点） |
| attachments 图片 | `MessageAttachments.tsx:32,48`（走 preview 路由） |

download **不是 URL 消费**（`api.ts:555-566` fetch→blob→`saveBlob`/桌面 IPC），不进 resolveResource；Content-Disposition header 仅在未来引入 `a[href]` 直下载时相关。

收口后 URL 精确断言迁移：`api.test.ts:54-87`、`api-adapter.test.ts:185-189` 改为对 resolveResource 断言（列入 §5 回归面）。

### D-R3：SW 响应器 = server 资源路由的 browser 等价物（修订：注入链双侧现状）

现状注入链是**双侧**：server 对 HTML 注入 `<script src="__spherse-sdk.js">`（`preview.ts:130-147`）+ 保留路由发 SDK bundle；app 侧 `html-card-src.ts` 做 charset/scrollable/ensureSdk（幂等，检测到已带标签即跳过）。

browser 版等价物（消费侧代码零改动）：

- **SW 对 HTML 响应注入 SDK script 标签**（等价 server 侧行为，非 app 侧内联——避免 SDK_SOURCE 内联进每张卡片 srcDoc 的体积膨胀）
- **SW 承接 `__spherse-sdk.js` 保留路由**：从构建产物（SW bundle 静态资源/CacheStorage 预热）响应 SDK bundle，任意目录层级语义同 `preview.ts:89-97`
- charset/scrollable 注入保持在 app 消费侧（现状不动）
- srcDoc fetch 失败降级路径（`HtmlCard.tsx:241-250` 落 `src=previewUrl`）：SW 模式下同一 URL 被 SW 拦截，行为等价（拿到带 SDK 的完整 HTML，**不退化**）

### D-R4：auth 按连接模式分支（修订：键=连接模式，非平台）

| 连接模式 | token 语义 |
|---|---|
| 桌面 localhost | 现状保留（`__auth/:token` 变体） |
| web 壳 → 远程 server（跨源） | **保留**（`packages/web` 既有刚需，SW 不在链路上） |
| browser 本地 SW（same-origin） | 消除 token-in-path；SW 响应器校验会话 |

SW 响应器需具备 `stripAuthPrefix` 等价（`preview.ts:54-59`）：带 `__auth` 段的 URL 落入 SW scope 时剥离后按正常路径处理（消费方在本地模式的过渡兼容）。SDK 侧 `__auth` 解析剥离（`sdk/src/runtime/events.ts:58-61`）行为不变。

会话同步（本地模式）：AuthProvider 状态写 **IndexedDB 持久 hint**（冷启动重建）+ BroadcastChannel 增量同步；SW 冷启动读 hint（M1）。

### D-R5：SW 生命周期

- 注册：app 启动注册，scope `/`；SW `install → skipWaiting + activate → clients.claim()`（**首次注册即控制当前页面**，消除首访绕过 SW 的空窗——M2）
- app 侧 await `serviceWorker.ready` + controller 确认后再渲染卡片区
- 更新：SW 独立构建入口固定名，浏览器 byte-diff；资源数据全在 OPFS（SW 升级不丢）
- SW 与 SharedWorker 并存：SW 只读 OPFS + 会话校验；写入属主唯一在 SharedWorker（browser-matrix 约束不受影响）
- 卡片热更新：SharedWorker 写后 BroadcastChannel → 页面刷新对应 iframe（不经 SW）
- cache-bust（`?v=`/`?t=`）：SW 响应 `Cache-Control: no-cache` + 忽略 query 差异直读 OPFS（与桌面 ETag 行为的差异：无 304，全量重取——卡片体量小可接受，写入已知差异表）

### D-R6：SW 响应器规格（与 server 路由逐项等价）

| server 现状 | SW 等价物 |
|---|---|
| 路径校验（`..` 逃逸拒绝） | 同语义 |
| 扩展名白名单拒绝 → 403 | 同（白名单随 server 常量共享，contracts 或 core 提供） |
| notFound → 404 / AccessDenied → 403 区分 | 同 |
| ETag/304 + `Cache-Control: no-cache` | no-cache + 无 304（已知差异，见 D-R5） |
| HTML 注入 SDK 标签 + `__spherse-sdk.js` 保留路由 | 同（D-R3） |
| Range 206（`createReadStream`） | `file.slice()` 206（spike ✅） |
| theme/attachments/preview 同路由面 | 同路由面 |

## 4. 平台矩阵（终态，修订）

| 能力 | 桌面 localhost | web→远程（跨源） | browser 本地 SW | browser 初版 |
|---|---|---|---|---|
| preview HTML + 相对资源 + SDK | HTTP 现状 | HTTP 现状 | SW 虚拟路由 | 占位 |
| theme（agent/全局） | HTTP 现状 | HTTP 现状 | SW 虚拟路由 | 回落默认 |
| attachments 图片 | HTTP 现状 | HTTP 现状 | SW 虚拟路由 | 占位 |
| download | fetch→blob/IPC | fetch→blob | 同左（不经 URL，SW 无涉） | 隐藏入口 |
| `__auth` token | 保留 | 保留 | 消除（strip 兼容） | — |

## 5. 验收（P3 完整形态，修订）

- **web e2e 基建**（P3 前置交付）：playwright chromium 驱动 web 壳（真实 SW/OPFS 环境），spike 断言按**终态**重写产品化（注入断言改为消费侧最终 DOM 形态，非 SW 侧中间态）
- 断言集：iframe 卡片渲染（SDK 标签经保留路由加载）、相对资源、Range 206、403（白名单外）/404 区分、`__auth` 剥离兼容、**本地模式 URL 无 token 泄漏**、安装竞态窗口（首访 claim 后资源可达）
- 跨端契约：resolveResource 双实现同输入一致性单测；`api.test.ts`/`api-adapter.test.ts` URL 断言迁移
- 桌面 + web 远程模式零回归（资源面路由与 token 行为不动，仅 app 侧收口到 resolveResource）

## 6. 风险表（修订）

| 风险 | 缓解 |
|---|---|
| SW 冷启动会话空窗 | IndexedDB 持久 hint（AuthProvider 写）+ BroadcastChannel 增量；hint 未就绪时 401 重试一次后提示 |
| 首次注册控制权 | `clients.claim()` + app await ready/controller（D-R5） |
| OPFS 存储压力逐出 | 启动请求 `navigator.storage.persist()`；逐出后按 P3 降级路径提示重装 |
| SW 更新窗口旧版拦截新路径 | 路径形态与 REST 一致只增不改；SW 无版本状态 |
| OPFS 大文件全量内存 | Range 惰性 slice；≤100MB 上限内记录已知限制 |
| 多标签 | SW 无会话外状态；per-tab 无状态 |
| iOS SW 激进回收 | SW 可重生（hint 重建）；注册由 app 启动保证 |

## Review 处理记录（2026-11-22）

- **C1**：注入链双侧现状勘误；D-R3 修订为 SW 注入 SDK 标签 + 承接 `__spherse-sdk.js` 保留路由（避免 srcDoc 内联膨胀）；降级路径等价性写明。✅
- **I1**：D-R4 分支键改为连接模式（三模式矩阵）；web→远程模式的 token 刚需与 SW stripPrefix 兼容写入。✅
- **I2**：D-R2 收口点完整清单（双 getPreviewUrl 实现/全局 theme 散点/attachments/download 修正为非 URL 消费）；URL 断言迁移列入回归面。✅
- **I3**：新增 D-R6 规格表（白名单 403/ETag 差异/304 缺失已知化/Content-Disposition 归未来）。✅
- **M1-M4**：会话 hint 持久化（D-R4）；clients.claim（D-R5）；persist() 风险行；web e2e 基建列为 P3 前置 + spike 断言按终态重写 + token 泄漏/竞态验收项。✅
- **minor**：cache-bust 差异已知化（D-R5）；URL 断言迁移（D-R2/§5）。✅
