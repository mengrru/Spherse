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

`isAllowedOrigin`（use-spherse-message-listener.ts:14）无条件放行 `eventOrigin === "null"`——任意 opaque origin 的 sandboxed iframe 都被视为可信 action 发送方。

## 与 PR #58 的关系

| 维度 | PR #58 前 | PR #58 后 |
|---|---|---|
| 外部恶意网页调 server API | 默认裸奔（无 token + `origin:true` 可读） | 401 且不可读（已修复） |
| iframe 内 LLM 生成 HTML 调 server API | 可（无 token，API 无认证） | 仍可（base href 携带 token） |
| iframe 经 parent 访问 electronAPI | 可 | 可（未触及） |

无回归；威胁主体不同（外部网页 vs 应用内 LLM 输出），修复层不同（server 网络边界 vs 渲染信任模型）。

## 修复方向（待立项）

1. **去同源**：移除 `allow-same-origin`（opaque origin）；runtime context 全走 postMessage（`injectRuntime` 已有 postMessage 备份路径，直写 `win.__SPHERSE__` 可废弃）
2. **capability token**：preview 资源加载与 API 调用分离——相对资源改用不含 server token 的短期/单卡片作用域凭据，或 preview 目录级一次性 ticket；杜绝 `__auth/<serverToken>` 进 iframe 可读的 base
3. **postMessage 白名单收紧**：`isAllowedOrigin` 移除 `"null"` 放行；action 增加来源 frame 校验
4. Electron 面缓解：评估 `nodeIntegrationInSubFrames`/`webPreferences` 与 renderer CSP（当前无任何 CSP，desktop/src/index.html）

前置依赖：`injectRuntime` 直写路径、E2E（ui-sdk-html-card.spec）对同源行为的假设需要一并迁移。
