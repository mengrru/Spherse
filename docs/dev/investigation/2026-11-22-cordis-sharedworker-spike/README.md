# Spike: cordis 在 SharedWorker 内运行验证（P0）

- 日期：2026-11-22
- 状态：**通过**（dev 与生产构建产物均验证）
- 关联设计：`docs/dev/infra/2026-11-21-plugin-runtime-rpc/design.md`（D5、P0、风险表「cordis 在 Worker 的兼容性未验证」）

## 结论

cordis 3.18.1（3.x 最新）可以在浏览器 ESM SharedWorker 内无 Node shim 运行：context 生命周期（`new Context()` → `ctx.plugin(fn)` → `ctx.start()`）、fiber 定时器（`ctx.setInterval`）、事件总线（`ctx.on`/`ctx.emit`）均正常工作。设计中的 D5 托管模型（runtime host = SharedWorker）**成立**，无需退化到 renderer 内 context。

## 验证矩阵（8/8 通过）

| # | 验证项 | 结果 | 说明 |
|---|---|---|---|
| 1 | worker-load | PASS | ESM SharedWorker 内 import cordis、context start、无 Node shim 报错 |
| 2 | multi-tab | PASS | 第二个标签页连接同一 SharedWorker 实例（单例计数器共享） |
| 3 | shared-state | PASS | 两标签计数一致（tab1=4 tab2=4，同源状态） |
| 4 | reload-survives | PASS | 标签 reload 后重连，计数连续（#4→#5，worker 未销毁）——「UI reload 不杀 turn」的机制前提成立 |
| 5 | other-tab-unaffected | PASS | 标签 1 reload 期间标签 2 事件流不断 |
| 6 | broadcast-fanout | PASS | BroadcastChannel 反向扇出（标签 → worker → 全标签 reset）生效 |
| 7 | context-introspect | PASS | postMessage 桥内省 worker 内 context（started: true） |
| 8 | no-page-errors | PASS | 两标签全程零 pageerror |

环境：Chrome headless（playwright chromium 1208）+ vite dev server 与 `vite build && vite preview` 生产产物各跑一遍，结论一致。

生产 bundle 检查：shared-worker 产物 65.59 kB（minify 前），**零 `node:` 导入、零 `require(`**——cordis 3.x 打包面是纯浏览器安全的。

## 发现的 API 偏差（P1 插件化设计需对齐）

- cordis **3.18.1 不导出 `definePlugin`**；函数式插件 `ctx.plugin((ctx) => {...})` 可用。若 P1 采用 4.x（`definePlugin` 存在于 4.x），API 面不同。
- `ctx.command` 不存在于 cordis core——commander 是独立包（`@cordis/commander`，随 4.x 生态）。RPC 方法组不依赖 commander，无影响；依赖 commander 的插件需另验。
- `ctx.services` 在 3.18.1 不可直接枚举（内部 registry 形态与文档有出入）；`ctx.provide()` 声明服务本身正常。

## demo 与复现

最小 demo（vite + cordis@3.18.1）：

- `src/shared-worker.ts`：SharedWorker 内 `new Context()` + 计数器插件（`ctx.setInterval` 每 500ms `ctx.emit("internal/tick")`）+ `onconnect` postMessage 桥 + BroadcastChannel
- `src/page.ts` / `index.html`：连接 SharedWorker、指令调用、tick 渲染
- `spike.mjs`：playwright 驱动双标签跑上述 8 项断言

复现（约 2 分钟）：

```bash
mkdir cordis-spike && cd cordis-spike
npm init -y && npm i cordis@3.18.1 vite
# 放入上述三个文件后：
npx vite --port 5199 & node spike.mjs        # dev 模式
npx vite build && npx vite preview --port 5200 & SPIKE_BASE=http://localhost:5200/ node spike.mjs
```

已知坑：worker URL 必须从独立模块文件解析（inline `<script type="module">` 的 `import.meta.url` 指向页面根，会拼出错误 worker URL 且静默失败）；SharedWorker 顶层异常不冒泡到页面 `pageerror`，调试时需在 worker 内自捕获。

## 未覆盖项（移交浏览器矩阵 spike）

- iOS Safari / Firefox 无 SharedWorker 或实现差异（本 spike 仅 Chrome）——按设计走退化形态（dedicated Worker，牺牲 reload 隔离），具体版本矩阵见 `2026-11-22-browser-matrix`。
- cordis 4.x（rc.13）的 Worker 兼容性：P1 拍板 3.x frozen vs 4.x 时需重跑本 spike（API 面已变，结论不可直接迁移）。
