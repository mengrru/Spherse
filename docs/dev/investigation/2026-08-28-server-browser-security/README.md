# 默认本地 Server 的浏览器安全边界评估

## 结论

报告属实，四项证据全部成立，且行号基本准确（cors 在 index.ts:68、registerAuthHook 在 index.ts:112、listen 在 index.ts:128、auth 早退在 auth.ts:46-47）。严重级别：**critical**，建议立即修复，不应推迟到 mobile tunnel 启用时。

## 逐项核实

### 1. 默认绑定固定 loopback 端口 — 成立

- `packages/server/src/index.ts:25` `DEFAULT_SERVER_PORT = 53972`；index.ts:126-128 优先尝试固定端口绑定 `127.0.0.1`，EADDRINUSE 才回退随机端口。
- 固定端口使恶意网页无需端口扫描即可定位服务。但注意：随机端口只能延缓（localhost 端口扫描很快），不能作为主要防御。

### 2. 无 token 时不注册认证 hook — 成立

- `packages/server/src/auth.ts:46-47`：`if (!token) return;`，无 token 则完全没有认证。
- 桌面端默认正是无 token：`packages/desktop/electron/settings.ts:228-232` `getMobileAccess()` 默认 `enabled: false, token: undefined`；`packages/desktop/electron/server.ts:22,27` 仅当 mobile token 存在才传 `auth`。

### 3. `cors({ origin: true })` — 成立

- `packages/server/src/index.ts:68`。`origin: true` 会反射任意请求 Origin 到 `Access-Control-Allow-Origin`，任意网站可跨域读取响应。
- `@fastify/cors` 默认 `credentials: false`（不带 cookie），但本服务是 bearer token 认证且默认无 token，该默认不构成缓解。
- "只绑定 127.0.0.1 不能防浏览器恶意网页"正确：这是经典 drive-by localhost 攻击。Chrome 的 Local Network Access（原 PNA）在逐步拦截 public→localhost 的 fetch/WS，但 Firefox/Safari 无等价机制，且 DNS rebinding（无 Host/Origin 校验）同样可绕过。

### 4. WebSocket 无 Origin 校验 — 成立

- `packages/server/src/ws-chat.ts:17-25`、`packages/server/src/ws-bus.ts:268`：handler 均不检查 `req.headers.origin`。
- 浏览器对 WS 不做 CORS 限制，唯一防线是服务端 Origin 校验；当前仅在有 token 时靠 query token 认证，默认态完全敞开。

## 实际攻击影响

默认配置下（桌面端启动、未开 mobile access），用户浏览器中的任意恶意网页可以：

1. **读写删项目文件**：`routes/content.ts:96,119,139`（POST mkdir/touch、PUT 写文件、DELETE）。
2. **驱动 Agent 执行工具**：创建 chat session、通过 chat WS 发消息（`routes/sessions.ts`、`ws-chat.ts`），Agent 工具权限内等价于任意命令执行面。
3. **枚举项目/数据**：file-tree、data、settings 等全部 GET 路由（配合 `origin: true` 可直接读响应）。

前提仅为：应用运行中 + 用户访问恶意页面（浏览器未拦截本地网络请求）。

## 修复建议（按优先级）

1. **Always-on local token（最高杠杆）**：首次启动即生成本地 secret（`settings.ts` 已有 `generateAccessToken`，settings.ts:225），桌面端恒传 `auth`，auth hook 恒注册。仅此一项即可让 drive-by 请求全部 401。PUBLIC_PATHS 保持最小（`/health` 可留，`/api/connection/info` 需复查是否泄露信息）。
2. **CORS 收敛为 allowlist**：替换 `origin: true` 为显式来源列表（dev 时 vite origin、mobile 启用时的 public domain）。Electron renderer 走 `loadFile`/`ELECTRON_RENDERER_URL`，本身不需要反射任意 Origin。
3. **WS upgrade 与全局 Origin/Host 校验**：对 `/ws/*` 在 upgrade 前校验 Origin ∈ allowlist；对所有请求校验 `Host` ∈ {localhost, 127.0.0.1, [::1]} 防 DNS rebinding。Origin 存在但不在 allowlist 时拒绝。
4. **次要增强（可选）**：默认随机端口、preview 路径 token 进 URL 的泄露面评估（`/preview/__auth/<token>/` 会进日志/历史，api.ts:436）。

### 与移动 tunnel 的关系

报告观点正确：认证秘密不应等到 mobile tunnel 启用才生成。mobile 的手动 token 机制可继续作为"对外暴露凭据"叠加在本地 always-on token 之上（或复用同一 token + 独立生命周期），方案设计时需澄清两者关系。

## 关联代码

| 位置 | 问题 |
|---|---|
| `packages/server/src/index.ts:68` | `cors({ origin: true })` |
| `packages/server/src/index.ts:126-128` | 固定端口绑定 loopback |
| `packages/server/src/auth.ts:46-47` | 无 token 不注册认证 |
| `packages/desktop/electron/server.ts:22,27` | 默认不传 auth |
| `packages/desktop/electron/settings.ts:225` | 已有 `generateAccessToken` 可复用 |
| `packages/server/src/ws-chat.ts:17` / `ws-bus.ts:268` | WS 无 Origin 校验 |
