# 本地 Server 浏览器安全边界加固

## 背景

默认本地 server 存在 drive-by 攻击面（调研详见 [investigation/2026-08-28-server-browser-security](../../investigation/2026-08-28-server-browser-security/README.md)）：

1. 无 token 时不注册认证 hook，桌面端默认无 token（`mobileAccess.token` 仅在开启 mobile access 时生成）
2. `cors({ origin: true })` 反射任意 Origin，任意网页可读响应
3. WS 无 Origin 校验、无 Host 校验（DNS rebinding 可绕过 Origin 语义）
4. 恶意网页默认态下可读写删项目文件（content 路由 PUT/POST/DELETE）、通过 chat WS 驱动 Agent 执行工具

核心结论：loopback 只解决网络可达性，不解决请求身份认证；认证秘密不应等到 mobile tunnel 启用才存在。

## 设计

### D1. Always-on server token（单 token 模型）

- **`serverToken` 存放层级钉死为 settingsStore 顶层 key**（与 `openProjects` 同级，settings.ts:15-23），**不是 `AppSettings` 字段**。原因：`saveSettings`（settings.ts:90-103）与 `getMaskedSettings` 均白名单式从零重建 `settings` 对象，放 AppSettings 内每次保存设置会静默丢 token → restart 后重新生成 → 所有已发凭据失效。
- `mobileAccess.token` 语义退役（读取兼容一个版本，不再写入）。
- `ensureServer()` 解析顺序：`serverToken` → （迁移）`mobileAccess.token` → `generateAccessToken()` 生成并持久化到 `serverToken`。
- 桌面端恒传 `auth: { accessToken }`，auth hook 恒注册。`registerAuthHook` 本身不改（无 token 早退保留给 server 包独立使用场景，如测试）。
- mobile 流程简化：`enable` 不再需要生成/轮换 token（已存在）；`regenerate-token` 轮换 `serverToken` 并 restart（复用现有 `restartServerWithAuth`）。
- 清理残留播种逻辑：`main.ts:16-18`（manual 模式预生成 `mobileAccess.token`）与 `mobile.ts:159-164`（set-mode 自动生成分支）随 D1 删除，避免继续写入退役字段。
- renderer 通道无变化：`bridge.getServerAccessToken` → `getMobileAccessState().token`，`buildState()` 改读 `serverToken`，恒有值。
- 单 token 理由：mobile token 本就授予完整 API 权限，拆两个 token 无权限增益，只增加轮换/展示复杂度。

### D2. CORS：以认证换反射，替代 `origin: true`

移除 `@fastify/cors`，自写 onRequest hook（`packages/server/src/cors.ts`）：

- **注册顺序硬约束：Host hook → CORS hook → auth hook**。preflight（OPTIONS）由浏览器发出、不携带 `Authorization`，若 CORS hook 在 auth hook 之后，所有 preflight 会被 401 短路 → renderer/PWA 全部带自定义头的请求失败（现 `@fastify/cors` 之所以能工作，正因其注册在 index.ts:68、早于 auth hook）。
- **preflight（OPTIONS）**：CORS hook 内直接 `reply.code(204).send()` 短路，反射 `Origin` / `Access-Control-Request-Headers` / `Access-Control-Request-Method`。放行仅表示"允许发送"，读权限由 actual response 控制。
- **actual response**：仅当请求携带**有效 token** 时设置 `Access-Control-Allow-Origin: <req Origin>` + `Vary: Origin`；无效或缺失则不设任何 CORS 头。永不设置 `Access-Control-Allow-Credentials`（本服务无 cookie 认证）。
- **token 枚举必须与 auth hook 完全同构**：bearer ?? query ?? **preview path token**（`auth.ts:57-59`）。漏掉 path token 会破坏 HTML 卡片历史加载——`HtmlCard.tsx:52` 的 `fetch(previewUrl)` 是裸 fetch，token 只在 URL 路径里（`/preview/__auth/<token>/...`），且该请求跨域、需读响应体。
- **实现约束**：两个 hook 均在 `createMultiProjectServer` 顶层 `addHook`，禁止包 `fastify.register()`（encapsulation 上下文内 hook 不作用于全局路由，会静默失效）。
- 效果：恶意网页无 token → 请求可达但 401 且**跨域不可读**；合法客户端（renderer、PWA）恒带 token → 可读。
- 公开路径（`/health`、`/api/connection/info`）同样适用：无有效 token 无 ACAO，跨域探测连版本信息都读不到；非浏览器客户端不受影响。

不采用静态 allowlist 的原因：web PWA 独立部署（GitHub Pages / 自有域名），Origin 无法预先枚举；"持有有效 token"是与 allowlist 等价的身份证明。

### D2b. PWA version guard 补 token

`packages/web/src/version-guard.tsx:57-60` 对 `/api/connection/info` 的 fetch 不带 token，D2 下会被 CORS 拦截且 `catch { return "ok" }` 静默吞掉 → 移动端版本不兼容拦截整体失效。修复：`runWebVersionGuard` 附带 `conn.token`（`readWebConnection` 就在手边）。

### D3. Host 校验（DNS rebinding 防御）

onRequest hook（先于路由）拒绝 Host hostname 不在集合内的所有请求（含 WS upgrade，handshake 走完整 fastify 生命周期，现有 auth hook 覆盖 `/ws/` 已证明）：

- 静态集合：`localhost`、`127.0.0.1`、`[::1]`（任意端口；`[::1]` 为前瞻项，当前仅绑 `127.0.0.1` 不会匹配）。**Host 头缺失或不可解析 → 一律拒绝**。
- 动态集合：`MultiProjectServer` 新增 `addAllowedHosts(hosts: string[])` / `removeAllowedHosts(hosts: string[])`。
- **注册时机（关键）**：动态集合是 server 实例状态，`restartServerWithAuth` 重建实例后即清空——manual 模式 regenerate-token 会 restart 但不触发任何 tunnel 事件。因此注册必须以"每次 `ensureServer()` 完成后按当前 mobileAccess 状态**重放**"为准（quick: tunnel `publicUrl`；manual: `publicDomain`），tunnel 状态变化事件只做增量增删。
- hostname 解析用 `URL`（如 `new URL(\`http://${host}\`)`）取 hostname，禁止 `startsWith` 前缀判断。
- **实现前置验证**（plan.md 第一项）：用真实 cloudflared 确认转发到 `http://localhost:{port}` 时的 Host 头形态，决定 quick 模式是否依赖动态注册。

### D3b. 日志脱敏 `__auth` path token

always-on 后所有 preview URL 恒携带 token，而 `index.ts:120-124` 的 `onResponse` hook 会对 `/preview/` 路径打 info 日志、logger 序列化只脱敏 query 不脱敏 path。顺手修复：`urlPath` 中 `__auth/<token>` 段替换为 `__auth/<redacted>`。

### D4. WebSocket

token 恒定后 `/ws/*` 已有强制 query token 认证，drive-by 场景已覆盖。**不再做 Origin allowlist**：PWA Origin 任意，静态列表必然误杀；rebinding 场景由 D3 Host 校验拦截。这是明确取舍：WS 的身份防线是 token，不是 Origin。

### D5. 公开路径与端口

- `/health` 返回 `{ok:true}`、`/api/connection/info` 返回版本号与 `authRequired`（将恒为 `true`），信息暴露极小，保留公开供客户端预连探测。
- 固定端口 `53972` 维持不变：token 使端口猜测失去意义，且 web 版/重连依赖其确定性。不作为防御手段。

## 已知取舍

- **破坏裸调 API 的既有用法**：用户脚本直接 `curl http://127.0.0.1:53972/api/...` 将开始收到 401。token 可从 settings 文件读取，在 architecture 文档记录。接受，安全性优先。
- **CORS hook 依赖 auth 校验逻辑**：D2 复用 token 校验（提取 `verifyPresentedToken(req, token)` 共享 helper），CORS 与 auth 的判定保持单一来源，避免两套逻辑漂移。
- **Electron prod renderer 为 `file://`（`Origin: null`）**：不需要特殊处理——D2 是认证制而非 Origin 制，null Origin 请求带 token 即可读。
- **mobile `enable` 后 `MobileAccessState.token` 恒有值**：UI 展示语义从"mobile 凭据"变为"server 凭据"，现有文案不改（同一 token，位置不变）。
- **version-guard 不补行为测试（review 后决定）**：`packages/web` 无任何测试基建（无 test script / vitest 配置），为一条断言新建整套基建超出本变更范围；服务端侧已有「无 token 无 ACAO」契约测试钉住失败根源，version-guard 附带 token 的行为留待 web 包引入测试基建时补。
- **legacy `mobileAccess.token` 残留**：迁移后不主动清空（避免用户回退旧版本时 token 失效导致已连接客户端全断），读取兼容一个版本后在后续版本一次性清理。

## 文件变更清单

| 文件 | 变更 |
|---|---|
| `packages/server/src/cors.ts`（新） | 认证制 CORS hook |
| `packages/server/src/auth.ts` | 导出 `verifyPresentedToken`（三形态：bearer ?? query ?? preview path）供复用 |
| `packages/server/src/index.ts` | 移除 `@fastify/cors`，顶层接入 Host → CORS → auth 三个 hook，`addAllowedHosts` API，`__auth` 日志脱敏 |
| `packages/desktop/electron/settings.ts` | settingsStore 顶层 `serverToken` key + `getServerToken()` 迁移逻辑 |
| `packages/desktop/electron/server.ts` | 恒传 auth；`ensureServer()` 后重放动态 host 注册 |
| `packages/desktop/electron/ipc/mobile.ts` | token 读写切到 `serverToken`；删除 set-mode 自动生成分支（159-164）；tunnel 状态变化增量增删动态 host |
| `packages/desktop/electron/main.ts` | 删除 manual 模式 token 预播种（16-18） |
| `packages/web/src/version-guard.tsx` | `runWebVersionGuard` 附带 `conn.token` |
| `docs/official/architecture/` 对应域文件 | 记录 server 认证模型与「裸调 API 从 settings 文件取 token」 |
| root / server `package.json` | 移除 `@fastify/cors` 依赖 |

`packages/desktop/src/host-bridge-electron.ts` 无结构变化（`getMobileAccessState` 返回值已含 token）。

## 验证

- server 契约测试：CORS（有效 token 反射 / 无 token 无 ACAO / preflight 204 短路 / **path-token 请求获得 ACAO** / 未注册路由上的 preflight）、Host（`evil.com` → 403、localhost 放行、Host 缺失拒绝、动态注册生效、**restart 后重放**）、auth 常态化后的既有 auth 测试回归。
- desktop 单测：settings 迁移（`mobileAccess.token` → `serverToken`、双空生成、已有 `serverToken` 不覆盖）；`ipc/mobile.test.ts` 重构（enable/set-mode 不再生成 token、regenerate 轮换 `serverToken`）。
- app：version-guard 携带 token 的行为测试。
- E2E：5 个直连 API 的 helper/spec 补 token（优先 `page.evaluate(electronAPI.getMobileAccessState())` 取 token，与 chat.ts:70-72 取 port 同模式，无需读 settings 文件）：`helpers/chat.ts`、`agent-list.spec.ts`、`floating-chat.spec.ts`、`ui-sdk.spec.ts`、`ui-sdk-html-card.spec.ts`；跑 server/chat 相关既有 spec。
- 手动：quick tunnel 全流程（含 WS）、manual domain 反代访问、manual 模式 regenerate 后域名仍可访问（I3 回归）、prod 打包 renderer（file:// origin）API/WS 正常。
- `npm run verify`。
