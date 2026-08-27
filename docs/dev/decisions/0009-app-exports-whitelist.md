# ADR-0009：壳消费 app 仅经 exports 白名单

- 状态：accepted
- 日期：2026-08-28
- 影响：`packages/app`（导出面）、`packages/desktop`、`packages/web`

## 背景

`@spherse/app` 曾无 `exports` 字段，desktop/web 经 `@spherse/app/src/...` 深度导入内部模块（web 甚至引用 `components/ui/*`、`stores/*`），全部 src 事实上成为公共 API，包边界形同虚设；desktop 因此在自身 dependencies 复制整棵 renderer 依赖树并被 electron-builder 打进安装包。

## 决策

- `packages/app` 以 package.json `exports` 显式白名单暴露壳消费入口（`./main`、`./host-bridge`、`./stores/*`、`./ui/*` 等 10 个），白名单即公共 API 面，增删入口强制过目
- 壳包（desktop/web）只允许从白名单入口导入；ESLint `no-restricted-imports` 禁止壳源码使用 `@/*` alias 深度导入 app 内部模块（alias 本身保留，供 app src 内部使用）
- 同轮将 desktop 依赖再分类：prod 只留 main/preload 外置引用（`@spherse/{server,core,i18n}`、electron-store、electron-updater），renderer 依赖转 devDependencies，asar 内 node_modules 485→328 包

## 后果

- 正：app 公共面显式可审计；desktop 依赖语义与运行时外置事实一致；安装包 asar 129MB→85MB
- 负：新增壳消费入口需同步维护 exports 白名单（一次性、低频）

## 原始记录

- `docs/dev/infra/2026-08-28-build-commands-package-boundaries/design.md`
