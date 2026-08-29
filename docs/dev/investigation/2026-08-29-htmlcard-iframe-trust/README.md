# HtmlCard iframe 信任模型调研

日期：2026-08-29
关联：PR #58（server 浏览器安全边界加固，未覆盖本问题）

## 结论

外部 report **基本属实**（两处细节需修正），严重级别 **critical**。该问题属于 UI SDK / preview 的信任模型层，与 PR #58 修复的 server 网络边界（外部 drive-by）正交，**本次修复未解决，也无回归**。

## 事实链（逐行核实）

### 1. 同源 iframe + 危险 sandbox 组合 — 属实

- `packages/app/src/features/chat/HtmlCard.tsx:175`：`sandbox = "allow-scripts allow-same-origin"`，三条渲染路径（content srcDoc / file_path srcDoc / fetch 失败降级 src）共用
- file_path 卡片**有意**改为 srcDoc 同源渲染（HtmlCard.tsx:202-204 注释明言"改用 srcDoc 后 iframe 继承父窗口 origin"）——同源是 `injectRuntime` 直写 `win.__SPHERSE__` 的依赖，是设计选择而非疏忽
- `allow-scripts + allow-same-origin` 是 MDN 明示的危险组合：被嵌文档可移除自身 sandbox 属性

### 2. SDK 白名单可被绕过 — 属实，且有两条更直接路径

SDK 三道防线——origin 检查（`use-spherse-message-listener.ts:9-18`）、限流（`checkRateLimit`）、action 注册表（`registry.ts:14-18`）——**全部只存在于 postMessage handler**，约束的是走协作协议的 SDK。不走协议的恶意 HTML 有：

- **路径 A（renderer 面）**：srcDoc + allow-same-origin → 与父窗口同源 → `window.parent.electronAPI` 直接可调。preload 暴露 38 个 `ipcRenderer.invoke` 方法（含 `getMobileAccessState`——直接读 server token、`openProject`、`showSaveDialog` 等）
- **路径 B（server 面）**：`html-card-src.ts:55,62` 注入 `<base href=".../preview/__auth/<token>/...">`（token 来自 `api.ts:436 getPreviewUrl`）→ 不可信 HTML 经 `document.baseURI` **必然拿到 server token** → Bearer fetch 全部 server API。PR #58 的认证制 CORS 会反射 renderer origin（token 有效）→ 响应可读——对这条路径**零防御作用，客观上还配合放行**

### 3. 需修正的两处细节

- report 称"preload 暴露了 electronAPI"暗示 iframe 直接可见：不准确。`nodeIntegrationInSubFrames` 默认 false，preload 只跑 top frame；iframe 须经 `window.parent` 访问。结论不变（同源下 parent 可达），路径描述需修正
- report 示意架构里"同源 renderer → Electron preload"是唯一链路：实际路径 B（server API 面）同等严重且独立成立（降级 src 模式下 iframe 直接就是 server origin + URL 带 token）

### 4. 附带发现（report 未提）

- `isAllowedOrigin`（use-spherse-message-listener.ts:14）无条件放行 `eventOrigin === "null"`——任意 opaque origin 的 sandboxed iframe 都被视为可信 action 发送方。
- main 进程无 `will-navigate` / `setWindowOpenHandler` 防护：同源 iframe 可 `parent.location = 'https://evil.com'` 把 renderer 导航到攻击者页面——落地后为 top-frame + 同源 + `electronAPI` 直接在手，绕过一切 frame 级防线。
- **content browser 预览 iframe 完全没有 sandbox**（ContentView.tsx:130-135，`src=previewUrl` 裸 iframe）：其 origin 是 server origin（与 renderer 跨源，够不到 parent/electronAPI），但 URL 路径同样携带 server token → 与 server 同源 → 路径 B 在此同样成立，且比 HtmlCard 少一层 sandbox 约束（可开窗、自导航）。
- **renderer origin 的 localStorage 在卡片内可读写**：srcDoc 卡片与 renderer 同源，共享其 localStorage。web 壳（PWA）中 `spherse:connection`（含 baseUrl + **server token 明文**，host-bridge-web.tsx:23）就在该 localStorage——卡片可直接读取。desktop 壳 renderer localStorage 目前无等价秘密，但与 app 共享存储本身就是越权面。content browser iframe（server origin）则有独立的 server-origin localStorage，不含 renderer 秘密。

## 与 PR #58 的关系

| 维度 | PR #58 前 | PR #58 后 |
|---|---|---|
| 外部恶意网页调 server API | 默认裸奔（无 token + `origin:true` 可读） | 401 且不可读（已修复） |
| iframe 内 LLM 生成 HTML 调 server API | 可（无 token，API 无认证） | 仍可（base href 携带 token） |
| iframe 经 parent 访问 electronAPI | 可 | 可（未触及） |

无回归；威胁主体不同（外部网页 vs 应用内 LLM 输出），修复层不同（server 网络边界 vs 渲染信任模型）。

## 可解性分析（2026-08-29 补充）

### 前提澄清：SDK 对同源的真实依赖

`sdk/src/runtime/context.ts:4-8` 写明 runtime 有两条传递路径：srcDoc 同源直写 `window.__SPHERSE__`（同步可用）与 `spherse:runtime` postMessage（跨源可用，preview 降级 src 模式今天就在用）。SDK 的 action/data/events 通道全部走 `window.parent.postMessage`（messaging.ts:48）。**同源唯一买到的是 runtime 同步 seed**——"HTML 需要 SDK 注入"不构成同源的必要性。

### 方案一：保持同源（用户前提）——可解到「高」，有固有残留

| 攻击面 | 可解性 | 手段 |
|---|---|---|
| 路径 B：token 泄露 → 全量 server API | ✅ 完全 | scoped preview ticket：preview URL 嵌单项目/短期/只读 `/preview/*` 的 ticket（内存 + TTL），与 server token 分离；`/api/*` 与 CORS hook 只认 server token，ticket 调 API 一律 401 无 ACAO |
| 路径 A-1：`parent.electronAPI`（38 个 IPC） | ✅ 完全 | ipcMain 统一经注册器包装，`event.senderFrame` 非 mainFrame 一律拒绝（Electron 41 支持） |
| 路径 A-2：导航/开窗劫持 | ✅ 完全 | `will-navigate` 默认拒绝 + `setWindowOpenHandler` 只走 openExternal |
| 路径 A-3：合成点击审批（`.click()` 触发 run_command 确认） | ✅ 可解 | 审批/危险确认按钮要求 `event.isTrusted`（合成事件恒 false） |
| `isAllowedOrigin` 的 `"null"` 放行 | ✅ | 移除，改为显式 origin 登记 |
| **残留：读 parent DOM + 共享 renderer localStorage** | ❌ 不可根除 | 同源的数学下限。web 壳中 `spherse:connection`（含 token）在 renderer localStorage——同源卡片可直接读，**此残留不可接受，至少需先把秘密移出 localStorage** |

### 方案二：opaque origin（去 `allow-same-origin`）——可完全解

「HTML 引用项目静态资源 + fetch 读项目文件」均不依赖同源：

- **静态资源**（img/script/link/media）：资源标签 no-cors 加载，不涉 CORS；`<base href>` 解析相对路径与 iframe 自身 origin 无关（preview 降级 src 模式跨源加载资源今天即正常）
- **fetch / @font-face / module script**：走 CORS——`Origin: null` 时服务端 `ACAO: null` 反射（sandboxed frame 标准行为）。将 PR #58 认证制 CORS 扩展为「preview 路径上凭据有效（server token 或 scoped ticket）→ 反射 Origin」即通
- **runtime / action / data**：postMessage，SDK 现成（context.ts 已支持异步等待）

代价：

- runtime 变异步：同步读 `window.__SPHERSE__` 不可用，须 `await spherse.getRuntime()`（SDK API 已有）——这是当初选同源的主要理由
- **卡片内 localStorage / indexedDB 不可用**（opaque origin 无存储）。对比：content browser 预览 iframe 是 `src` 直载（server origin，真 origin），**其 localStorage 不受影响**——只有改成「无 allow-same-origin 的 sandbox」才会失去存储；保持现状（或 `sandbox="allow-scripts allow-same-origin"` + server origin src）则存储保留
- 存量卡片若依赖 localStorage 需排查

**结论**：方案二把方案一的「DOM 读取 + localStorage 共享」残留一并归零，修复从「可解到高」变为「完全可解」；唯一实质代价是 runtime 异步化与卡片无存储。两方案共享同一块地基：scoped preview ticket（路径 B 的解法与 origin 选择正交）。

## 修复方向（待立项，按方案二推荐）

1. **scoped preview ticket**：preview 资源加载与 API 调用凭据分离；ticket 单项目、短期、只读 `/preview/*`，不得用于 `/api/*` 与 CORS 授权以外的任何路径；HtmlCard 与 content browser 一并切换（content browser 同时补 sandbox）
2. **opaque origin**：HtmlCard iframe 去掉 `allow-same-origin`；`injectRuntime` 废弃 `win.__SPHERSE__` 直写，全走 postMessage
3. **postMessage 白名单收紧**：`isAllowedOrigin` 移除 `"null"` 放行；action 增加来源 frame 校验
4. **Electron 加固**（两方案通用）：`event.senderFrame` IPC 门、`will-navigate` / `setWindowOpenHandler` 锁、审批 UI `isTrusted`
5. **秘密出 localStorage**（两方案通用）：web 壳 `spherse:connection` 迁移至非同源卡片可读的存储（或方案二下该问题自动消失——opaque 卡片够不到 renderer localStorage）

前置依赖：E2E（ui-sdk-html-card.spec）对同源行为的假设需一并迁移；存量卡片 runtime 同步读取与 localStorage 使用需扫描。
