# 自动更新检测与手动检查体验修复

## 背景

两个问题：

1. 手动检查更新在「无新版本」时把主进程状态固化为 `upToDate`，settings 重开后 `getUpdateState()` 恢复的还是 `upToDate`，「已是最新版本」按钮永远禁用，直到重启 App。
2. 已有的启动静默检查（main.ts 启动 5s 后 `checkForUpdates({silent:true})`）只在 settings About 页打开时才有人监听事件，通知大概率丢失；且没有运行期间的周期性检测。

## 设计

### 状态语义：交互状态与静默检测解耦

- 主进程 `updater.currentState` 只服务手动交互流程：silent 检查完全不改写它（不再写 `checking`/`upToDate`/`error`/`available`），避免静默结果污染 settings UI 可恢复状态。
- `update-available` 事件携带 `silent: boolean`（手动检查为 `false`）；`update-not-available`/`update-error` 在 silent 下维持现有「不发事件」语义。
- renderer 挂载恢复规则（`useUpdateChecker`）：只有进行中/待确认的流程状态跨挂载恢复（`available`/`downloading`/`downloaded`），终态（`idle`/`checking`/`upToDate`/`error`）一律归位 `idle`——重开 settings 后「检查更新」按钮恢复可点击。

### 通知路由：silent 走 toast，手动走 Dialog

- 新增全局空渲染组件 `UpdateNoticeBridge`（挂载在 App 根，与 `ApprovalNoticeBridge` 平级）：收到 silent `update-available` 时在右下角弹 toast（sonner 默认位置），标题复用 `settings.update.newVersion`，按钮「去更新」（新 i18n key `settings.update.goUpdate`）`openExternal` 打开平台对应下载链接，链接缺失回退官网；duration 10s。
- settings About 页的 `useUpdateChecker` 忽略 silent `update-available`（不弹 Dialog），避免 settings 恰好打开时 Dialog + toast 双弹；手动检查仍走 Dialog。
- web 端无 `bridge.updater`，组件空转。

### 周期调度：main 进程 `startAutoUpdateChecks()`

替代 main.ts 原有的启动 setTimeout：

- 启动 5s 后执行首次 silent 检查并记录 `lastCheckAt`（刚打开 App 必然在活动）。
- 之后每小时 tick 一次，同时满足才执行：距上次检查 ≥ 24h，且 `powerMonitor.getSystemIdleTime() < 5min`（用户活动期间）；不满足则等下一个 tick。
- 每次执行（无论结果）推进 `lastCheckAt`，即自动检测至多每天一次；新版 toast 每次检测至多一条。

## 已知取舍（review 后确认）

- 手动检查不推进调度器 `lastCheckAt`：自动检测的 24h 节流只统计自动检查；用户 dismiss 新版 Dialog 后，次日的自动检测仍会 toast 同一版本，作为每日重提醒语义接受。
- 启动首查的 5s 固定延时继承自旧实现：若 renderer 初始化（restoreProjects）超过 5s 未就绪，`update-available` 事件可能无人监听而丢失，且需等下一个 24h tick；常规加载远快于 5s，接受该窗口。
- 手动检查发现新版且用户 dismiss 后，主进程状态保持 `available`，重开 settings 会重新弹出确认 Dialog：作为「有新版待处理」的持续提示，沿用改动前既有语义。

## 验证

- desktop `updater.test.ts`：silent 不改写状态、事件带 silent 标志、调度器（fake timers + powerMonitor mock）启动/24h 节流/空闲跳过。
- app：`use-update-checker` 挂载恢复归位规则、`UpdateNoticeBridge` 行为测试（silent 才弹、action 打开下载链接）。
- `npm run check:i18n`、lint、typecheck、相关 workspace 单测。
