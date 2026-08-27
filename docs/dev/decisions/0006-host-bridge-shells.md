# ADR-0006：三壳共享 renderer，宿主差异经 HostBridge 抽象

- 状态：accepted
- 日期：2026-07-20
- 影响：`packages/app`（共享 renderer）、`packages/desktop`、`packages/web`

## 背景

移动端需求来临：用户要在手机上继续对话、查看项目内容。分叉一套移动 renderer 意味着双倍维护；但桌面能力（IPC、文件系统、更新器）在浏览器里不存在。

## 决策

- renderer 单份代码（`packages/app`），不按宿主分叉
- `HostBridge` 抽象宿主能力：`ElectronHostBridge`（IPC 全能力）与 `WebHostBridge`（HTTP / WS 子集，经 tunnel 或手动地址连接桌面 server）
- `HostCapabilities` 声明能力开关，renderer 据此条件渲染宿主专属 UI

## 后果

- 正：桌面 / 移动同源演进；新 feature 默认双端可用
- 负：每个宿主特有能力都要先在接口声明、再在两壳实现；能力矩阵需要持续维护

## 原始记录

- `docs/dev/features/2026-07-20-mobile-app/`
