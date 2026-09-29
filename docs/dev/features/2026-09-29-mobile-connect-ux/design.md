# 移动端连接体验增强：应用内扫码 + 连接 loading 修复 + 断开连接入口

## 背景

移动端 web（`packages/web` PWA）当前连接桌面端只有手动输入 baseUrl + token 一种方式。历史上曾实现过应用内摄像头扫码（`2244e8f8`，jsQR + getUserMedia，BarcodeDetector 优先），但在 iOS 上始终无法识别，最终在 `b21b20a4` 被整体移除，改为「系统相机扫 QR → 打开 `https://.../#/?base=..&token=..` → URL 参数自动连接」。此外存在两个已知问题：

1. **连接成功后闪回登录界面**：`handleConnect` 内的 `restoreProjects` 会把全局 `initializing` 置 true，`App.tsx` 随即用全屏 loading 替换整棵树（连接页被卸载、`submitting` 状态丢失）；restore 完成后连接页以初始状态重新 mount（表单重新出现），此时还需等待 `runWebVersionGuard` 走一次隧道 RTT 才 navigate 到项目页——这段窗口即用户看到的「闪回登录」。
2. **无断开连接入口**：全仓没有任何清除 `spherse:connection` 的用户入口（唯一清除点是版本墙 overlay 的「重新连接」），已记录在 `docs/dev/backlog.md` 移动端待办。

附带发现（顺手修复）：web 首访未连接时 `App.tsx` mount 调用的 `useBusStore.init(bridge)` 拿到空 URL，`WsConnection.openSocket` 静默返回且不排重试；连接成功后无人重新 init，全局 bus（trigger/agent/fs-watch 通道）要等整页 reload 才工作。

## 目标

1. 恢复应用内扫码连接，并在 iOS 上可靠工作；
2. 消除连接成功后的登录页闪回；
3. web 端侧边栏 ActivityBar 底部（移动端为侧栏抽屉左下角、桌面浏览器为屏幕左下角）增加断开连接按钮，点击弹 AlertDialog 确认。

## 当年 iOS 扫码失败的根因分析

来自 fix 链（`77299816` → `0dc2f4a0` → `b21b20a4`）的考古结论：

- iOS Safari 17.4 之前没有 `BarcodeDetector`，只能走 jsQR 路径；
- jsQR 路径把视频帧降采样到 480px，且 `getUserMedia` 未请求分辨率约束（iOS 默认给低分辨率流），而 QR 内容是 ~150 字符的 URL（高版本、高模块密度），两者叠加导致每一帧都解码为 null——即摄像头预览正常但「扫码无反应」；
- iOS 上 `video.play()` 的时序问题（`onloadeddata` 后才 play）加剧了部分场景的卡死。

修复策略针对以上三点：高分辨率约束、BarcodeDetector 优先（iOS 17.4+ / Android Chrome 均支持）+ jsQR 高分辨率兜底（960px）、`srcObject` 赋值后立即 `play()` + `muted`/`playsInline` 显式落 DOM。另加「识别二维码图片」兜底（`<input type="file" accept="image/*">`，iOS 弹「拍照或选取照片」），摄像头被拒/不可用时依然可连接——静态图解码不受实时流分辨率限制，100% 可靠。

## 设计

### D1. 连接 payload 解析（纯函数，`packages/app`）

新文件 `packages/app/src/lib/connect-payload.ts`，收编 `MobileAccessPanel.tsx` 中现有的 `buildDeeplink` 并新增解析函数：

```ts
export function buildConnectUrl(opts: { baseUrl: string; token: string; targetPath?: string }): string
// 现状逻辑：`${WEB_APP_URL}#/?base=..&token=..[&targetPath=..]`

export interface ParsedConnectPayload { baseUrl: string; token: string; targetPath?: string }
export function parseConnectPayload(text: string): ParsedConnectPayload | null
```

解析规则（宽松，面向扫码/图片识别出的任意文本）：

- `new URL(text)` 解析失败或非 http(s) → null（含旧 `spherse://connect` 协议，返回 null）；
- 依次尝试 `url.searchParams` 与 hash 内 query（hash 去掉前导 `#` 与 `/` 后按 query 解析，兼容 `#/?base=..` 与 `#?base=..`）；
- 取 `base`、`token`，任一为空 → null；`targetPath` 可选；
- 不校验 host 是否为 `WEB_APP_URL`（dev/prod 部署路径、未来域名变化都不影响；base/token 是绝对值，从哪个页面扫出都可直接连）。

放在 app 而非 web 的理由：`buildConnectUrl`（桌面端）与 `parseConnectPayload`（web 端）是同一 wire 格式的两侧，收编后可写 round-trip 单测；app 已有 vitest 基建而 web 没有。app 的 `package.json` exports 增加 `"./connect-payload": "./src/lib/connect-payload.ts"`（对齐 `./version-compat` 现有惯例）。`MobileAccessPanel` 改为从该模块导入。

### D2. 应用内扫码（`packages/web`）

`MobileConnectPage` 恢复双入口结构：`mode: "menu" | "scan" | "manual"`。menu 为默认（两个 outline 按钮：扫码连接 / 手动输入）；manual 为现有表单 + 返回按钮。

`ScanPanel` 要点：

- **依赖**：`packages/web` 重新引入 `jsqr@^1.4.0`（与历史版本一致）。
- **摄像头**：`getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } })`；`<video muted playsInline>`，effect 中显式 `video.muted = true`（纯 CSR 下 React 19 客户端本就会设置该 property，此处作为跨环境双保险保留）、`srcObject` 赋值后立即 `await video.play()`（muted + playsInline 允许免手势自动播放；rejection catch 降级到错误态）。
- **帧调度**：`video.requestVideoFrameCallback` 可用（Safari 15.4+）则按新帧解码，unmount 时 `cancelVideoFrameCallback`（同样 15.4+）+ cancelled 守卫双保险；否则 `setTimeout` 300ms 轮询；解码重入保护（上一帧未完成则跳过）；`readyState < HAVE_CURRENT_DATA || videoWidth === 0` 时等待。
- **解码**：`BarcodeDetector`（构造 `{ formats: ["qr_code"] }` 成功即用，`detect(video)`）优先；jsQR 兜底（canvas 降采样 maxDim = 960，`inversionAttempts: "attemptBoth"`，`willReadFrequently: true`）。
- **结果**：解码出文本 → `parseConnectPayload` → 命中则停流并回调 `onDetected(conn)`；解出文本但不命中 → 显示 `invalidQr` 提示并继续扫；持续无解码则无 UI 噪音（仅 console.debug）。
- **错误态**：`NotAllowedError`/`SecurityError` → `cameraDenied`；其他失败或无 `getUserMedia` → `scanUnavailable`。错误态提供「识别二维码图片」与「手动输入」两个出口。
- **图片识别兜底**：隐藏 `<input type="file" accept="image/*">`（不带 `capture`，iOS 同时提供拍照与相册），change 后 `createImageBitmap(file)` → canvas 降采样 maxDim = 960 → BarcodeDetector 或 jsQR 解码；失败再用原图（`createImageBitmap` 原尺寸）试一次（QR 只占画面小部时保底）；仍失败 toast `invalidQr`。扫码界面常驻该入口按钮，与错误态共用。
- **清理**：unmount / 检出成功即停所有 track、取消定时器与 rVFC；`detectedRef` 防重复回调。

**退路声明**：历史上「BarcodeDetector 优先 + jsQR 兜底」的结构在 `0dc2f4a0` 已落地且真机仍失败后被移除。本次差异点是分辨率约束（1280×720 ideal + 960 解码，当年无约束 + 480）、rVFC 帧调度与 play 时序修复；但 iOS 真机识别率无法在桌面验证，**验收兜底标准是：即使实时扫码在部分 iOS 环境仍不可靠，「识别二维码图片」（拍照/选图）与「手动输入」必须可用且能完成连接**。

### D3. 连接 loading 修复（闪回）

- `app-store.restoreProjects(bridge, opts?: { initialGate?: boolean })`：默认 `true` 维持现状（App 冷启动门）；`initialGate: false` 时不翻转 `initializing`（入口不置 true，成功/失败路径也不置 false），其余逻辑（connection/projects/activeProjectId/返回值）完全不变。连接页调用时连接页组件保持 mounted，`submitting` 状态不再因卸载丢失。
- `MobileConnectPage.handleConnect`：
  - `restoreProjects(bridge, { initialGate: false })` 与 `runWebVersionGuard()` **并行**（`Promise.all`，省一个串行隧道 RTT）；版本不兼容时维持现状（挂 overlay、不 navigate、`finishConnect` 经 `pendingOnDismiss` 在用户「暂不升级」后补执行）。onDismiss 回调用 late binding（`runWebVersionGuard(() => finishRef.current?.())`，`finishRef` 在 `Promise.all` 之后赋值），避免闭包引用尚未就绪的 `firstProjectId`；overlay dismiss 需人手点击，时序上必然晚于赋值。边角情况：restore 失败 + 版本不兼容并存时 toast 与 overlay 同时出现，可接受；
  - `submitting` 期间连接页主体（menu/scan/manual 面板位置）渲染「连接中」态：旋转 loader 图标 + `mobile-connect.connecting`，表单不再闪现；
  - 连接成功后 `void useBusStore.getState().init(bridge)` 重新拉起全局 bus（`init` 内 `isActive` 守卫 + 旧连接 close 重建，空 URL 的 idle 残留连接会被正确替换），修复首连后 bus 通道不工作的问题。
- **App 冷启动 restore 失败兜底（仅 web）**：`App.tsx` mount effect 的 `restoreProjects` 增加 catch，`bridge.kind === "web"` 时 toast `mobile-connect.connectFailed`（`{error}` 传 `err.message`，即 web bridge fetchJson 的 `/api/projects: …` 原文）；死连接保留在 localStorage 不清除（隧道可能只是暂时挂了，重试无害），桌面行为不变。

### D4. 断开连接按钮

- **HostBridge 契约**：`HostBridge` 增加可选方法 `clearConnection?(): Promise<void>`（与 `getServerAccessToken?` / `saveBlob?` 同类可选方法先例，`host-bridge.ts:152-158`）；web bridge 实现为 `localStorage.removeItem(WEB_CONNECTION_STORAGE_KEY)`，桌面不实现。依赖方向不变（web → app）。不走 capabilities：`host-capabilities.structure.test.ts` 钉死了字段清单，且 capabilities 语义是「能力程度」而非动作。
- **入口**：`ActivityBar` 底部按钮区（`DebugTools` 旁）增加 icon button，新增 `bridge.kind === "web"` 分支（先例：`OnboardingPage.tsx:7` / `App.tsx:92`；不入 feature-registry，该机制目前只有 ELECTRON_ONLY/ALL_HOSTS 两种集合、无 web-only 先例）；`LogOut` 图标 + tooltip「断开连接」。移动端位于侧栏抽屉内 ActivityBar 底部（左下角），桌面浏览器 web 为屏幕左下角。
- **确认**：复用 `AlertDialog`（仓库既有确认弹窗模式）：标题「断开连接？」、描述「将清除已保存的连接信息并返回连接页」、取消/确认（确认按钮 default variant，断开不是破坏性操作）。AlertDialog 经 Portal 挂 body，不受侧栏抽屉容器 `inert={!mobileOpen}` 影响（已验证，弹窗打开期间 Base UI modal 反向 inert 外部内容）。
- **断开流程**：确认后 `await bridge.clearConnection?.()` → `window.location.reload()`。采用 reload 而非手工清理，理由：
  - 单个项目关闭就需要清 11 个面（`project-lifecycle.ts:22-34`：chat WS links、agent-session-list/trigger/tabs/split-pane/custom-side-panel 等 feature store、`project-data-store`、nav 栈…），枚举清理面是长期维护陷阱——chat WS links 靠 5 分钟 TTL 兜底（`session-lifecycle.ts`），断开后旧连接最长存活 5 分钟，与「断开」语义冲突；
  - reload 顺带重置 version guard 的会话级状态（`version-guard.tsx` 的 `overlayDismissed` / `lastNotified` / `pendingOnDismiss`）：否则「连上不兼容桌面 → 暂不升级 → 断开 → 重连不兼容桌面」会因 `overlayDismissed` 既不挂 overlay 也不 navigate，静默死局；
  - 现成先例：版本墙 overlay 的「重新连接」按钮（`version-block-overlay.tsx:32-40`）就是 removeItem + reload；
  - 代价仅一次 PWA 白屏，对移动端完全可接受。
- 不需要 app-store `resetForDisconnect`、bus teardown、queryClient.clear（reload 全覆盖）；不 toast「已断开」（reload 后无意义）。
- `spherse:last-active-project` 与 `spherse:settings` 保留：重连同桌面可恢复上次项目；跨桌面连接时 id 不存在 → `restoreProjects` 已有 fallback 到第一个项目的逻辑。

### D5. i18n

zh-CN 为基准，同步 **zh-TW 与 en**（三个 locale key 集合必须一致，`check-i18n.mjs` 强制校验；zh-CN 每条新键带逐条注释）。复用既有键：`mobile-connect.scan / manual / scanHint / back / cameraDenied / scanUnavailable / invalidQr / connect / connected / connectFailed`（`invalidQr` 注释中的旧 `spherse://connect` 说明更新为 https 链接）。新增：

| 键 | zh-CN | zh-TW | en |
|---|---|---|---|
| `mobile-connect.connecting` | 正在连接… | 正在連線… | Connecting… |
| `mobile-connect.decodeFromImage` | 识别二维码图片 | 辨識 QR Code 圖片 | Decode from image |
| `mobile-connect.disconnect` | 断开连接 | 中斷連線 | Disconnect |
| `mobile-connect.disconnectTitle` | 断开连接？ | 中斷連線？ | Disconnect? |
| `mobile-connect.disconnectDescription` | 将清除已保存的连接信息并返回连接页 | 將清除已儲存的連線資訊並返回連線頁 | This will clear the saved connection and return to the connect page |

取消按钮复用 `common.cancel`。

## 不做的事

- 不做扫码结果的服务端校验提前（连接动作本身即校验，失败走既有 toast）；
- 不改 QR 内容格式与桌面端 `MobileAccessPanel` 的生成逻辑（只收编 `buildDeeplink` 为 `buildConnectUrl`，行为等价）；
- 不给 web 包新增 vitest 基建（ScanPanel 组件测试性价比低，靠纯函数单测 + 手动验证清单）；
- 不处理 iOS PWA standalone 模式的摄像头历史限制（iOS 14.3+ 已支持，且有图片识别兜底）。

## 测试

- `packages/app/src/lib/connect-payload.test.ts`：buildConnectUrl ↔ parseConnectPayload round-trip；query 与 hash 两种携带方式；dev/prod 部署 URL（dev URL 用例需 `vi.stubEnv("MODE", "development")` + `vi.resetModules()` 动态 re-import，先例 `urls.test.ts`）；`targetPath` 有无；旧 `spherse://` 协议 / 缺参数 / 非 URL → null。
- `packages/app/src/stores/app-store.test.ts`（**扩展**既有文件）：`restoreProjects` 默认翻转 `initializing`；`initialGate: false` 全程不翻转且 store 结果一致（mock bridge）。
- 手动验证清单（见 plan.md）：iOS Safari 真机扫码（BarcodeDetector 路径）、权限拒绝 → 图片识别路径、连接全程无登录页闪回、断开 → 回连接页 → 重连。

## 影响面

| 文件 | 变更 |
|---|---|
| `packages/app/src/lib/connect-payload.ts` | 新增 |
| `packages/app/src/lib/connect-payload.test.ts` | 新增 |
| `packages/app/src/stores/app-store.ts` | `restoreProjects` opts |
| `packages/app/src/stores/app-store.test.ts` | 扩展 |
| `packages/app/src/lib/host-bridge.ts` | `clearConnection?` |
| `packages/app/src/features/activity-bar/index.tsx` | web 断开按钮 + 确认弹窗 |
| `packages/app/src/App.tsx` | mount restore catch（web toast） |
| `packages/app/src/features/settings/MobileAccessPanel.tsx` | 改用 `buildConnectUrl` |
| `packages/app/package.json` | exports `./connect-payload` |
| `packages/web/src/pages/MobileConnectPage.tsx` | 双入口 + ScanPanel + connecting 态 + bus re-init |
| `packages/web/src/host-bridge-web.tsx` | `clearConnection` 实现 |
| `packages/web/package.json` | `jsqr` 依赖 |
| `packages/i18n/src/locales/{zh-CN,zh-TW,en}.ts` | 键调整与新增 |
| `docs/official/project-structure.md` | web 壳描述更新 |
| `docs/official/architecture/frontend.md` | HostBridge 可选方法清单补 `clearConnection`；web 壳连接引导节核对 |
| `docs/dev/backlog.md` | 移动端待办条目内删去「断开连接」短语（不整条删） |
