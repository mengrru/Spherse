# [Bug] 修复本地启动 Electron 路径问题 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `electron-vite dev` 启动前显式设置 `ELECTRON_EXEC_PATH` 环境变量，确保始终使用本项目安装的 Electron 二进制。

**Architecture:** 新建一个轻量 dev 启动脚本，解析本项目的 electron 二进制路径并设置环境变量，然后调用 electron-vite dev。修改 package.json 的 dev script 指向新脚本。

**Tech Stack:** Node.js ESM, electron-vite v3, electron ^35.0.0

**Design doc:** `docs/dev/bugfix/2026-05-29-electron-path-fix.md`

---

### Task 1: 创建 dev 启动脚本

**Files:**
- Create: `packages/app/scripts/dev.mjs`

- [ ] **Step 1: 创建 scripts 目录和 dev.mjs 文件**

```js
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const require = createRequire(import.meta.url);

const electronModulePath = dirname(require.resolve("electron/package.json"));
const pathFile = resolve(electronModulePath, "path.txt");

if (!existsSync(pathFile)) {
  console.error(
    "Error: electron path.txt not found. Run `npm install` first."
  );
  process.exit(1);
}

const executablePath = readFileSync(pathFile, "utf-8").trim();
const electronExecPath = resolve(electronModulePath, "dist", executablePath);

process.env.ELECTRON_EXEC_PATH = electronExecPath;

console.log(`Using Electron: ${electronExecPath}`);
execSync("electron-vite dev", { stdio: "inherit", env: process.env });
```

---

### Task 2: 修改 dev script 指向新脚本

**Files:**
- Modify: `packages/app/package.json:8`

- [ ] **Step 1: 修改 packages/app/package.json 的 dev 脚本**

将第 8 行：
```json
"dev": "electron-vite dev",
```
改为：
```json
"dev": "node scripts/dev.mjs",
```

---

### Task 3: 验证

- [ ] **Step 1: 从项目根目录运行 `npm run dev`，确认控制台输出 `Using Electron: <path>`，路径指向本项目的 `node_modules/electron/dist/`**

Run: `npm run dev`
Expected: 控制台输出 `Using Electron:` 后跟本项目路径，应用正常启动，无 better-sqlite3 版本不匹配报错
