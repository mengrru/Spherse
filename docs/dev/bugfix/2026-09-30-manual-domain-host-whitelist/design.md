# 手动模式自定义域名 403 Forbidden host（host 白名单未注册）

## 现象

移动访问选「手动」模式、公网域名已保存（如 `mengru.spherse.org`，自动规范化为 `https://…`），界面展示 token 与二维码一切正常，但经自定义域名访问 API 时被 403 拒绝；浏览器侧无 ACAO 头，报成 CORS 错误。quick tunnel（`*.trycloudflare.com`）一切正常。

## 定位链

1. CORS 中间件（`packages/server/src/middlewares/cors.ts`）不是域名白名单：认证制回显 Origin，preflight 无条件回显。
2. 真正按域名拦截的是 host-guard（`packages/server/src/middlewares/host-guard.ts`）：静态 `localhost/127.0.0.1/::1` + 动态 `addAllowedHosts`。hook 注册顺序 hostGuard → cors → auth，host-guard 403 的响应不带 ACAO 头，浏览器一律显示为 CORS 错误。
3. quick tunnel 正常是因为 tunnel 状态变化自动 `syncAllowedHosts()` 加白 publicUrl；manual 模式依赖 `desiredHosts()`（`packages/desktop/electron/server.ts`）返回 `publicDomain`。
4. `desiredHosts()` 首行 `if (!mobile.enabled) return [];` 把 manual 域名也拦住了。而 UI（`packages/app/src/features/settings/MobileAccessPanel.tsx`）的启用开关只在 quick 模式渲染，`enableMobileAccess` 仅在 quick 开关中调用且写死 `{ mode: "quick" }`；模式切换按钮 `disabled={enabled}`，必须先 disable 才能切到 manual。因此走到 manual 模式时 `enabled` 必为 false → 域名永不进白名单 → 403。
5. manual 模式下二维码只依赖 `publicUrl && token`，不依赖 `enabled`，故界面看起来一切正常，掩盖了白名单为空的事实。

## 根因

`enabled` 语义只对应 quick tunnel 的启停，却作为 manual 域名注册的前置条件；manual 模式下域名保存即激活才是实际 UX（后端 `mobile-access:enable` IPC 虽支持 manual，但 UI 无入口调用）。

## 修复

`packages/desktop/electron/server.ts` `desiredHosts()`：manual 分支提前到 `enabled` 检查之前——`mode === "manual" && publicDomain` 非空即加白，与 `enabled` 解耦；quick 分支维持 `enabled` 门控（tunnel 只在启用时存在）。

切换语义自洽：manual→quick（未启用）时 desired 为空，域名自动移出白名单；`syncAllowedHosts` 的 remove-then-add 机制保证旧 host 清理。

## 测试

`packages/desktop/electron/server.test.ts`：

- `registers publicDomain in manual mode regardless of enabled`：enabled=false / true 两种状态下 manual 域名均注册
- `removes manual domain after switching to disabled quick mode`：切回未启用的 quick 后域名移出白名单
- restart replay 用例改为 manual + enabled=false，覆盖真实 UI 可达状态
