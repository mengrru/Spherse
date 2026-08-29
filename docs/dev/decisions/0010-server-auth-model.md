# ADR-0010：本地 server 鉴权模型（always-on token + 认证制 CORS + Host 校验）

- 状态：accepted
- 日期：2026-08-28
- 影响：`packages/server/src/{index,auth,cors}.ts`、`packages/desktop/electron/{settings,server,ipc/mobile,main}.ts`、`packages/web/src/version-guard.tsx`；取代「loopback + 可选 mobile token」旧模型

## 背景

旧模型认为「只绑 127.0.0.1」即安全：默认无 token、auth hook 不注册、`cors({ origin: true })` 反射任意 Origin、无 Host/Origin 校验。但 loopback 只限制网络可达性，不防用户浏览器中恶意网页的 drive-by 请求（借浏览器发起的请求就是本地回环请求）；默认态下可读写删项目文件、驱动 Agent 工具、读全部 API 响应。调研见 `docs/dev/investigation/2026-08-28-server-browser-security/`。

## 决策

- **always-on token**：desktop 首启生成（`serverToken`，settingsStore 顶层 key），auth hook 恒注册；不等待 mobile tunnel 启用
- **认证制 CORS**：preflight 无条件反射放行（仅授权发送）；actual response 仅当 token 有效才设 `ACAO: <req Origin>`。PWA 任意部署 Origin → 静态 allowlist 不可行，token 即身份
- **Host 校验**：静态 `localhost`/`127.0.0.1`/`[::1]` + 动态注册（tunnel publicUrl / manual publicDomain），防 DNS rebinding；缺失或不可解析拒绝
- WS 不做 Origin allowlist（PWA Origin 任意），身份防线是 token、rebinding 由 Host 校验拦截
- 单 token 模型：mobile token 与本地 token 合一，拆分无权限增益

## 后果

- 正：drive-by 读/写/探测全面被拒；凭据单点（`verifyPresentedToken`）供 auth 与 CORS 复用
- 负：裸调本地 API 的脚本开始收到 401（从 settings 文件取 token）；`mobileAccess.token` 读取兼容一个版本后清理

## 原始记录

- `docs/dev/features/2026-08-28-server-browser-security/`（design + plan + review 处理）
