# Plan：本地 Server 浏览器安全边界加固

Design：[design.md](./design.md)

## 前置验证

- [x] cloudflared 转发 Host 头形态——本机无 cloudflared，重放式注册对两种形态均健壮（Host 被重写为 localhost → 静态集合覆盖；保留公网域名 → 动态注册覆盖），归入手动测试项兜底

## server 包

- [x] `auth.ts`：提取 `verifyPresentedToken(req, token)`（bearer ?? query ?? preview path，内部复用现有 extractor + safeEqual），导出供 CORS hook 复用
- [x] `cors.ts`（新）：`registerAuthGatedCors(fastify, getToken)`——OPTIONS 短路 204 反射头；actual 请求 token 有效才设 `ACAO: <origin>` + `Vary: Origin`
- [x] `index.ts`：
  - 移除 `@fastify/cors` 注册与依赖
  - 顶层 onRequest：Host 校验 hook（静态集合 localhost/127.0.0.1/[::1]，缺失/不可解析拒绝）→ CORS hook（都在 `registerAuthHook` 之前）
  - `MultiProjectServer` 增加 `addAllowedHosts` / `removeAllowedHosts`
  - `onResponse` 日志：`__auth/<token>` 段脱敏
- [x] 契约测试：`browser-security.test.ts`（Host 6 例 + CORS 8 例）

## desktop 包

- [x] `settings.ts`：settingsStore 顶层 `serverToken` key；`getServerToken()`（迁移并持久化）/ `setServerToken()`
- [x] `server.ts`：`ensureServer()` 恒传 auth；`syncAllowedHosts()` 期望态重放（enabled + quick→publicUrl / manual→publicDomain）；`restartServerWithAuth` 更名 `restartServer`（无 auth 参数）
- [x] `ipc/mobile.ts`：`buildState().token` 改读 `getServerToken()`；enable/set-mode 删除生成分支；regenerate-token 轮换 `serverToken`；tunnel onStateChange 与各 handler 调 `syncAllowedHosts()`
- [x] `main.ts`：删除 manual token 预播种
- [x] 单测：settings 迁移/持久化 6 例；`ipc/mobile.test.ts` 重构（enable/set-mode 不再生成 token、regenerate 轮换 serverToken、disable/mode/domain 触发 sync）

## web 包

- [x] `version-guard.tsx`：`runWebVersionGuard` fetch 附带 `Authorization: Bearer <conn.token>`

## E2E

- [x] `helpers/chat.ts`：`getServerAccessToken` / `authHeaders`，`createSessionViaApi` 附 Authorization
- [x] `agent-list.spec.ts`、`floating-chat.spec.ts`、`ui-sdk.spec.ts`（含 `getSessionMessageCount`）、`ui-sdk-html-card.spec.ts`：裸 fetch 补 Authorization；顺修 `ui-sdk.spec.ts` openSession 用例缺 `await` 的浮动断言（被多一次 evaluate 的竞争放大）

## 验证

- [x] `npm run verify` 通过（lint 0 errors 既有 warnings；server 270 / desktop 171 全绿；i18n check 通过）
- [x] E2E：agent-list / floating-chat / ui-sdk / ui-sdk-html-card / chat-retry / chat-withdraw / app-launch / file-tree 通过；`ui-sdk.spec.ts:199 rate limit` 与 `chat-retry` 偶发超时为干净 dev 上可复现的既有问题（stash 验证），与本变更无关
- [ ] 手动（延后）：quick tunnel、manual domain、manual regenerate 后仍可访问、prod 包 renderer

## Review 反馈处理（commit 2）

- [x] M1：补 `desktop/electron/server.test.ts`（desiredHosts/syncAllowedHosts 期望态 6 例，含 restart 重放与 publicUrl 变化），不 mock 被测模块
- [x] M2：web 无测试基建，记录「不补」决定到 design 已知取舍
- [x] m1：删除 removeAllowedHosts 违规注释
- [x] m2：legacy token 清理时点记录到 design 已知取舍
- m3：doc-sync 步骤处理（见下）

## 收尾

- [ ] doc-sync：architecture 安全域文件、settings 存储约定（data-conventions）、backlog
