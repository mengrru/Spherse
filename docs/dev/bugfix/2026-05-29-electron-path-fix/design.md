# [Bug] 修复本地启动 Electron 路径问题

## 现象

`npm run dev` 启动后，Electron 应用可以打开，但控制台报 `better-sqlite3` 版本不匹配错误：sqlite 原生模块编译时对应的 Electron ABI 版本与实际运行的 Electron 二进制版本不一致。

有时 `install -> build -> dev` 后不会复现，具有环境依赖性。

## 根因分析

### 问题一：electron 版本未锁定

`electron` 使用 `^35.0.0` 范围版本，不同环境可能安装不同小版本。`better-sqlite3` v11 只提供到 Electron 36 的预编译二进制，已无法满足任何当前支持的 Electron 版本。

### 问题二：postinstall 覆盖 Node.js prebuild

`rebuild-native.mjs` 在 `postinstall` 中用 Electron ABI 的 prebuild 覆盖了 Node.js prebuild，导致 `npm install` 后 Node.js 测试必然失败。

### 版本兼容性

| Electron | Node.js | ABI | better-sqlite3 v11 | better-sqlite3 v12 |
|----------|---------|-----|---------------------|---------------------|
| 35 | 22 | 133 | ✅ | ✅ |
| 36 | 22 | 135 | ✅ (最高) | ✅ |
| 37-39 | 22 | 136-140 | ❌ | ✅ |
| 40 | 24 | 143 | ❌ | ✅ |
| 41 | 24 | 145 | ❌ | ✅ (最高) |
| 42 | 24 | 146 | ❌ | ❌ (V8 API 变更) |

## 修复方案

采用社区标准做法，三个改动：

### 1. 锁定 Electron 精确版本

`packages/app/package.json`:
```diff
- "electron": "^35.0.0",
+ "electron": "41.7.1",
```

选择 Electron 41 的理由：
- 当前受支持（EOL 2026-08-25）
- Node.js 24（现代 LTS）
- better-sqlite3 v12 有对应的预编译二进制
- Electron 42 因 V8 API 变更暂不支持 better-sqlite3

### 2. 升级 better-sqlite3

`packages/core/package.json`:
```diff
- "better-sqlite3": "^11.0.0",
+ "better-sqlite3": "^12.10.0",
```

项目使用的 API（`Database`、`prepare`、`run`、`get`、`all`、`exec`、`pragma`、`close`）在 v11→v12 无破坏性变更。

### 3. postinstall 改为 predev

`package.json` (root):
```diff
- "postinstall": "node scripts/rebuild-native.mjs",
+ "predev": "node scripts/rebuild-native.mjs",
```

**为什么这样改：**
- `postinstall` 阶段运行 rebuild-native 会用 Electron prebuild 覆盖 Node.js prebuild
- 改为 `predev` 后，`npm install` 保留 Node.js prebuild（测试正常），`npm run dev` 前自动切换为 Electron prebuild
- `npm run dev` 流程：`predev`（rebuild-native）→ `dev`（workspace dev）→ `electron-vite dev`

## 影响范围

- `packages/app/package.json`：electron 版本锁定
- `packages/core/package.json`：better-sqlite3 升级
- `package.json` (root)：postinstall → predev
- 不影响：前端代码、构建配置、electron-vite 配置

## 验证方式

1. `npm install` 后 `npm test --workspace=packages/core` 通过（Node.js prebuild）
2. `npm run dev` 自动执行 rebuild-native，应用正常启动（Electron prebuild）
3. `better-sqlite3` 不报版本不匹配错误
