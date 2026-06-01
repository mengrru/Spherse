# Bugfix: 首次 build 报错，第二次 build 成功

## 问题描述

执行 `npm run build` 时，若 `packages/core/dist/` 不存在（首次构建或 clean 后），`@spherse/app` 的 `electron-vite build` 报错：

```
[commonjs--resolver] Failed to resolve entry for package "@spherse/core".
The package may have incorrect main/module/exports specified in its package.json.
```

再次执行 `npm run build` 则成功，因为第一次构建已经生成了 `dist/` 目录。

## 根因分析

### 构建执行顺序问题

根目录 `package.json` 的构建命令为：

```json
"build": "npm run build --workspaces"
```

`npm run <script> --workspaces` 对所有 workspace **并行**执行脚本，启动顺序取决于 `workspaces` 字段的 glob 展开（`packages/*` → 按字母序：app, core, presets, server），而非依赖拓扑序。

实际执行顺序（实测）：

1. `@spherse/app` — `electron-vite build` ← **最先执行**
2. `@spherse/core` — `tsc`
3. `@spherse/presets` — `tsc`
4. `@spherse/server` — `tsc`

### 失败机制

1. `electron-vite build` 的 main process 配置使用 `externalizeDepsPlugin()`，该插件在 externalize 前需先 resolve 模块路径以判断是否属于 node_modules
2. `@spherse/app/electron/server.ts` → `@spherse/server` → `@spherse/core`（传递依赖链）
3. `@spherse/core` 的 `package.json` 中 `main` 和 `exports` 均指向 `dist/index.js`
4. 此时 `@spherse/core` 尚未构建，`dist/index.js` 不存在 → resolve 失败
5. 第二次构建时 `dist/` 已存在，resolve 成功

### 正确的依赖拓扑序

```
@spherse/core ─────┐
                    ├─→ @spherse/server ──→ @spherse/app
@spherse/presets ───┘────────────────────→ @spherse/app
```

- Layer 1: `@spherse/core`, `@spherse/presets`（无 workspace 依赖，可并行）
- Layer 2: `@spherse/server`（依赖 core）
- Layer 3: `@spherse/app`（依赖 server + presets）

## 方案对比

### 方案 A：显式按拓扑序链接构建命令（推荐）

修改根目录 `package.json` 的 `build` 脚本：

```json
"build": "npm run build -w @spherse/core && npm run build -w @spherse/presets && npm run build -w @spherse/server && npm run build -w @spherse/app"
```

**优点**：
- 改动最小，仅修改一行脚本
- 无需引入新依赖或新文件
- 构建顺序明确、可预测
- 符合项目当前规模（4 个包，无需复杂工具）

**缺点**：
- 新增 workspace 包时需手动更新构建顺序
- core 和 presets 无法并行构建（但两者构建速度都很快，影响可忽略）

### 方案 B：引入 turborepo / nx

使用 monorepo 构建工具自动处理拓扑排序和缓存。

**优点**：
- 自动推断依赖顺序
- 支持构建缓存，增量构建更快

**缺点**：
- 引入重量级依赖，对 4 个包的项目过度工程化
- 需要额外配置文件
- 增加 CI/本地环境复杂度

### 方案 C：在 @spherse/core 添加 prepare 脚本

在 `@spherse/core` 的 `package.json` 中添加 `"prepare": "tsc"`，使 `npm install` 时自动构建。

**优点**：
- 每次 install 后 dist/ 自动存在

**缺点**：
- install 时编译拖慢安装速度
- 无法控制其他包的构建顺序
- 治标不治本，根本问题是构建顺序

## 推荐方案

**方案 A**：显式按拓扑序链接构建命令。

理由：项目当前仅 4 个包，依赖关系简单且稳定，无需引入额外工具。改动最小、风险最低。

## 实施计划

### 修改内容

修改 `package.json` 的 `build` 脚本：

```json
{
  "scripts": {
    "build": "npm run build -w @spherse/core && npm run build -w @spherse/presets && npm run build -w @spherse/server && npm run build -w @spherse/app"
  }
}
```

### 验证步骤

1. 清理所有 dist 目录：`rm -rf packages/*/dist`
2. 执行 `npm run build`，确认所有包按序构建成功，无报错
3. 再次清理，再次构建，确认稳定可复现
