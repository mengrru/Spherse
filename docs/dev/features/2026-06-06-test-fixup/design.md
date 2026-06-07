# UT 修复 & E2E 冒烟测试整理

## 背景

项目当前有 3 个 workspace 配置了单元测试（`@spherse/core`、`@spherse/i18n`、`@spherse/app`），以及 `@spherse/app` 下 3 个 Playwright E2E spec。运行测试发现三类问题：

1. **`@spherse/core` 的 `session.test.ts`（10 个测试）全部失败** — `better-sqlite3` 是 native addon，在 Electron 构建环境中编译后与系统 Node.js 的 `NODE_MODULE_VERSION` 不匹配（147 vs 137），导致 `SessionStore.init()` 中 `new Database(dbPath)` 抛出异常。
2. **`@spherse/app` 的 2 个 test suite 无法加载** — `project-data-store.test.ts` 和 `useAiReadDenylist.test.ts` import `@spherse/i18n`，但 `@spherse/i18n` 的 `dist/` 未在测试前编译，导致模块解析失败。
3. **所有 E2E spec 全部失败** — `window.electronAPI` 为 `undefined`，原因是 `electron/window.ts` 中 preload/renderer 的相对路径 `../preload/index.js` 在 chunk 输出结构下解析错误（代码被打包到 `dist/main/chunks/` 下，需要 `../../preload/index.js`）。

此外，运行中发现 `pino` 的 `thread-stream` worker 线程在 app 退出时先于 WebSocket close handler 退出，导致异步 `stream.emit('error')` 变成 Uncaught Exception。

## 目标

1. 修复所有失败的单元测试（0 个 suite 失败）
2. 确保现有 3 个 E2E spec 可运行
3. 新增 1 个 app 启动验证 smoke test
4. 修复 app 退出时的 pino worker thread 崩溃

## 不做的事

- 不给 `@spherse/server`、`@spherse/presets` 新增测试
- 不给 `@spherse/core` 新增测试用例（只修复已有的）
- 不添加 root 级统一 `test` 脚本

## 设计

### Part 1：pretest rebuild better-sqlite3（修复 session.test.ts）

`better-sqlite3` 是 native addon，`npm run dev` 会通过 `scripts/rebuild-native.mjs` 为 Electron 的 Node 版本编译。运行 UT 时系统 Node.js 版本不匹配导致加载失败。

**方案：** 在 `packages/core/package.json` 添加 `pretest` 钩子：

```json
"pretest": "npm rebuild better-sqlite3"
```

npm 生命周期钩子保证 `pretest` 在 `vitest run` 之前执行，将 `better-sqlite3` rebuild 为当前系统 Node.js 版本。测试使用真实 SQLite，无需 mock。

**权衡：** 每次 `npm test` 多几秒 rebuild 时间，但测试真实 SQLite 行为，不会因 mock 不准确而遗漏 bug。运行 `npm run dev` 时 `predev` 钩子会再次 rebuild 为 Electron 版本，互不影响。

### Part 2：修复 app 测试的 i18n 构建依赖

在 `packages/app/package.json` 中修改测试脚本：

```json
{
  "scripts": {
    "pretest": "npm run build --workspace=@spherse/i18n",
    "test": "vitest run",
    "test:e2e": "npm run build --workspace=@spherse/i18n && npm run build && playwright test -c playwright.config.ts"
  }
}
```

- `pretest` 钩子确保 `@spherse/i18n` 的 `dist/` 在 vitest 前已编译
- `test:e2e` 内联 prebuild（因为 npm 不支持 `pretest:e2e` 这种生命周期钩子），确保 i18n 和整个 app 都已 build

### Part 3：修复 E2E preload 路径

`electron-vite` 将主进程代码打包到 `dist/main/chunks/` 子目录。`electron/window.ts` 中使用 `import.meta.url` 获取 `__dirname`，路径从 `dist/main/chunks/` 出发，原相对路径 `../preload/index.js` 解析到不存在的 `dist/main/preload/`。

**修复：** 将 `../` 改为 `../../`：

```ts
preload: path.join(__dirname, "../../preload/index.js"),
// ...
mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"));
```

### Part 4：新增 app-launch smoke test

新增 `packages/app/e2e/app-launch.spec.ts`，验证 Electron 启动后主界面可见：

1. 用 `createFileTreeProject()` 创建临时项目
2. `_electron.launch()` 启动 app
3. 验证 `aside`（sidebar）和 "文件" 文本可见

### Part 5：修复 pino worker thread 退出导致的 Uncaught Exception

`pino.transport()` 创建 `thread-stream` worker 线程。app 退出时 worker 先于 WebSocket close handler 退出，`thread-stream.write()` 通过 `setImmediate(() => stream.emit('error', err))` 异步抛错，try-catch 无法捕获。

**修复：** 在 `packages/server/src/index.ts` 中，自行创建 transport 并添加 `.on("error", () => {})` listener，传入 Fastify 的 `logger.stream` 选项：

```ts
const fastifyTransport = pino.transport({
  target: "pino-pretty",
  options: { colorize: true },
});
fastifyTransport.on("error", () => {});

const fastify = Fastify({
  logger: { level: "debug", stream: fastifyTransport },
});
```

不能用 Fastify 内置的 `logger.transport` 配置，因为 Fastify 内部创建 transport 时我们无法拿到实例来加 listener。改用 `stream` 选项传入我们自己创建的带 listener 的 transport，行为与原来等效。

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `packages/core/package.json` | 修改 | 添加 `pretest` rebuild better-sqlite3 |
| `packages/app/package.json` | 修改 | 添加 `pretest`、内联 `test:e2e` prebuild |
| `packages/app/electron/window.ts` | 修改 | preload/renderer 路径 `../` → `../../` |
| `packages/app/e2e/app-launch.spec.ts` | 新增 | App 启动验证 smoke test |
| `packages/server/src/index.ts` | 修改 | Fastify logger transport 加 error listener |
| `packages/server/src/ws-fs-watch.ts` | 无变更 | close handler 日志保留，由 Part 5 兜底 |
| `packages/server/src/ws-chat.ts` | 无变更 | close handler 日志保留，由 Part 5 兜底 |
| `packages/server/src/ws-debug.ts` | 无变更 | close handler 日志保留，由 Part 5 兜底 |

## 验证标准

1. `npm test --workspace=packages/core` → 0 failed, 129 passed
2. `npm test --workspace=packages/i18n` → 0 failed, 10 passed
3. `npm test --workspace=packages/app` → 0 failed（包括之前失败的 2 个 suite）
4. `npm run test:e2e` → 所有 spec 通过（含新增的 app-launch）
5. `npm run lint` → 无错误
6. 退出 app 时无 pino Uncaught Exception
