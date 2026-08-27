# Plan

## ① 命令体系整理

- [x] root `workspaces` 改显式拓扑序列表
- [x] root scripts：`build` / `verify` / `typecheck` 全 workspace 化，删 `build:desktop`，统一 `-w @spherse/<pkg>` 风格
- [x] i18n：删重复 `check:i18n`，补 `lint` / `lint:fix`
- [x] landing：补 `lint:fix`
- [x] 实证 npm workspace 执行顺序 + 全量 `npm run build`

## ② desktop 依赖再分类

- [x] 基线：electron-vite build + `electron-builder --dir`，记录体积与 node_modules 清单（.app 425MB / asar 129MB / 485 包，其中 73 个 react/markdown 链）
- [x] desktop package.json：prod 只留 electron-store / electron-updater / @spherse:{server,core,i18n}；renderer 依赖转 devDeps；删 diff / js-yaml / @types
- [x] `npm install` 更新 lockfile，重新打包对比体积与清单（.app 366MB / asar 85MB / 328 包 / react 链 0）
- [x] 打包产物 node_modules 核对（server/core/i18n/presets/sdk/fastify/pi 树完整、react 树消失）

## ③ app exports 白名单

- [x] app package.json 增加 `exports`（10 入口）
- [x] desktop：`src/main.tsx`、`src/host-bridge-electron.ts`、`electron/preload.ts`、`electron/types.ts`、`electron/ipc/mobile.ts` 改新入口（后两处为实施中发现的漏网相对导入）
- [x] web：`main.tsx`、`host-bridge-web.tsx`、`version-guard.tsx`、`version-block-overlay.tsx`、`MobileConnectPage.tsx` 改新入口
- [x] 移除 desktop / web vite 配置的 `@spherse/app/src` alias
- [x] typecheck + build 验证无深度导入残留

## ④ 收尾

- [x] backlog「基础设施」节新增：contracts 拆包、Turborepo 评估两条
- [x] AGENTS.md 命令区同步（workspaces 有序列表语义）
- [x] `npm run verify` 全绿 + `app-launch.spec.ts` E2E 通过
- [ ] doc-sync 自查
