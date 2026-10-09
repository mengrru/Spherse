# 移动端带项目 id 路由冷启动卡死「项目不存在」

## 现象

移动端（web PWA）载入时若路由带项目 id（`#/project/<id>/...`），且 localStorage 中保存的连接已失效（桌面未开 / 隧道不可达 / token 已 regenerate），页面显示「项目不存在」纯文本，无重载、退出或修复入口；用户只能手动删掉 hash 里的项目 path 再载入。手机 PWA 从主屏图标恢复上次 URL 是典型触发场景。

## 定位链

1. 项目 id 由 `ProjectScope`（`packages/app/src/layouts/ProjectScope.tsx:22`）从 hash 路由读取；其本身不发请求，只查 `app-store` 的 projects map，找不到即渲染 not-found dead-end（`:74-80`）。
2. 冷启动时 store 数据来源是启动 `App.tsx:58-60` 的 `restoreProjects`（web 走 HTTP，token 作 query，server 端 `middlewares/auth.ts` 校验 401）。
3. `restoreProjects` 失败分支（`app-store.ts:119-122`）设 `initializing:false` 并 rethrow，store 留空；`App.tsx:80-87` catch 后仅弹 toast，不导航——与 `!projectId` 分支（`:64-72`，a76c3e3 专为防 stranding 加的 web 回退 navigate("/")）不对称。
4. 自动补偿 `useReconnectedSync`（`App.tsx:35-56`）依赖 bus WS 成功 open（`bus-store` 才设 `resumedAt`），而认证坏掉时 WS 握手被 auth 中间件拒绝、无限 backoff 空转，补偿永不触发。所有自愈路径恰好都依赖那条已断的连接。

对照两个不卡死场景：无保存连接 → restore 返回 null → 同步 navigate("/")（已修复路径）；连接有效但项目 id 不在列表 → WS 正常 → 重连补偿数秒内自愈。

## 根因

启动流程把 `restoreProjects` 结局二分为「成功」或「未连接」，web 存在第三种结局——已保存但失效的连接——该分支清掉 `initializing` 后按路由渲染项目 UI，且所有自动补偿均以连接恢复为前提，失效连接下无任何人工出口。

## 修复

双保险，改动面均在 web 分支内：

1. **启动失败回退（App.tsx catch 分支）**：web 上 restore 失败时，除既有 toast 外，若当前 hash 非根路径则 `navigate("/", { replace: true })` 回连接页——与 `!projectId` 分支对称。连接页有扫码 / 手输 / 断开保存连接的完整入口，用户可重新认证。
2. **not-found 兜底出口（ProjectScope）**：web 上 not-found 分支（非 initializing）追加「返回连接页」按钮，navigate("/")。防其他未知路径 stranding（如 WS 长期握不上但 restore 已成功的边缘时序）。

桌面不受影响：restore 走本地 IPC 不验 token，且 WS 补偿可用。

按钮文案为用户可见字符串，走 `@spherse/i18n` 三 locale 新增 key `pages.projectNotFoundBackToConnect`。

## 已知取舍（review 结论）

- **瞬时失败也回退**：隧道抖动等瞬时 restore 失败同样被 navigate("/") 踢回连接页，且无自动回归（避免拽走正在手输 token 的用户）。恢复路径：reload（hash 已是 `/`，重启 restore 自动进项目）或重扫码。严格优于现状 dead-end。
- **按钮目标恒为 `/`**：连接健康但项目 id 无效（书签过期 id）时点按钮落到扫码页而非有效项目；该场景下 WS 重连补偿（`App.tsx:35-56`）会在数秒内自动 navigate 到 activeProject，按钮真正服务的是连接坏掉、补偿永不触发的场景。「连接页在 store 有项目时提供回到项目入口」记为后续增强。

## 测试

- `packages/app` 组件测试（`createMemoryRouter` + `createMockHostBridge({ kind: "web" })`，参照 `TabBar.test.tsx` 模式）：
  - ProjectScope not-found：web 渲染「返回连接页」按钮且点击 navigate 到 `/`；electron 不渲染；initializing 时不渲染
  - App 启动 catch 回退为组件内 effect，依赖 router/bridge context，以 ProjectScope 兜底按钮 + 手动验证覆盖（该区域既有测试即 structure test，不为 catch 分支引入重型 harness）
- 手动 / E2E：模拟失效连接（改 localStorage token）带项目路由冷启动 → 落连接页；断开重连流程可正常回到项目
