# Spike: 浏览器兼容矩阵 + OPFS 多写者约束验证（P0）

- 日期：2026-11-22
- 状态：**完成**（矩阵数据 caniuse/MDN 实拉 + OPFS 实验 Chromium 实测）
- 关联设计：`docs/dev/infra/2026-11-21-plugin-runtime-rpc/design.md`（P0、D5、决策表 Worker 托管模型）

## 一、目标浏览器矩阵（四大依赖特性）

数据源：caniuse（2026-11 实拉 sharedworkers/serviceworkers/broadcastchannel）与 MDN Baseline（OPFS，Baseline 2023-03）。Safari 5–5.1 对 SharedWorker 的 `y` 为历史支持后移除（6.1–15.x 全线 `n`），按现代支持线取值。

| 特性 | Chrome | Edge | Firefox | Safari | iOS Safari | Samsung Internet | Firefox Android |
|---|---|---|---|---|---|---|---|
| SharedWorker | 4+ | 79+ | 29+ | **16.0+** | **16.0+** | ✗（至今未支持） | 新近才标记（历史上长期 ✗，按 ✗ 处理） |
| OPFS（含 Worker 内 `createSyncAccessHandle`） | 102+ | 102+ | 111+ | 15.2+ | 15.2+ | — | — |
| Service Worker | 45+ | 79+ | 44+ | 11.1+ | 11.3+ | 4+ | 44+ |
| BroadcastChannel | 54+ | 79+ | 38+ | 15.4+ | 15.4+ | 7.2+ | 38+ |

**结论矩阵（取各行 max 作为基线）**：

| 基线 | 桌面 | 移动 |
|---|---|---|
| 完整形态（SharedWorker 托管） | Chrome 102+ / Edge 102+ / Firefox 111+ / Safari 16+ | iOS Safari 16+ / Android Chrome |
| 退化形态（dedicated Worker，牺牲 reload 隔离） | — | Samsung Internet、Firefox Android（若实测确不支持 SharedWorker） |

iOS Safari 16.0（2022-09，对应 iOS 16）是完整形态的最低门槛，覆盖近四年机型；低于 16 的 iOS 走退化形态或不支持（P3 定义降级面时再定）。OPFS 为 secure-context-only：浏览器版必须 HTTPS（或 localhost 调试）。

## 二、OPFS 多写者约束实验（Chromium 实测）

实验：两个 Dedicated Worker 对同一 OPFS 文件并发操作（源码 `opfs.html` / `src/opfs-worker.ts`，playwright 驱动）。

### 结果

| 实验 | 结果 |
|---|---|
| A 持有 `createSyncAccessHandle` 期间 B 尝试获取 | **被拒**：`NoModificationAllowedError: Access Handles cannot ...`（独占锁） |
| A `close()` 后 B 再获取 | 成功（锁释放，可移交） |
| `createWritable` 顺序双开 append | 两者成功 |
| `createWritable` **并发**双开 append（读旧 size 后各自追加） | 双开成功但 **A2 的写入静默丢失**（最终内容只有 B2 的追加） |

### 结论

1. **sync handle 路径**（sqlite-wasm / event-log append 将采用的路径）：浏览器强制单写者，跨 context 亦然——违反「存储属主唯一」时表现为写入失败（可检测、可拒绝），不会数据交错。
2. **writable 路径**：无锁、可双开、**静默丢写**（swaptmp + last-writer-wins）。多标签各自起 runtime 的场景若走此路径会无提示丢数据。
3. 设计决策确认：「OPFS 只由 SharedWorker 内的 runtime 访问，禁止多标签各自起 runtime 写同一 session」**必要且必须为硬约束**——SharedWorker 单例是天然属主仲裁；退化形态（dedicated Worker）下多标签并存时需显式属主选举或直接禁止多标签并发写（P3 落地时按设计处理）。

## 三、实验过程中的工程坑（P3 实现时复用）

- **postMessage 在 worker `onmessage` 赋值前到达即丢**（属性赋值无队列）：worker 模块有顶层 await 时，主线程必须等 worker 发出 ready/boot 信号后才能发指令——P3 的 postMessage transport 握手必须内置。
- vite dev 下非入口 HTML 的 inline module script 走 html-proxy，server 重启后代理失效（`No matching HTML proxy module found`）——demo 页面一律用外置 `<script src>`。
- SharedWorker 顶层异常不冒泡到页面 `pageerror`，调试需 worker 内自捕获回传。

## demo 位置

实验代码在临时区 `cordis-spike/`（`opfs.html`、`src/opfs-worker.ts`、`src/opfs-page.ts`、`opfs-spike.mjs`），复现方式与 `2026-11-22-cordis-sharedworker-spike` 相同（vite + playwright chromium）。

## 附：`@modelcontextprotocol/client` browser 面终验（P0 第四项）

`@modelcontextprotocol/client@2.2.0`：exports 将 `./stdio`（Node 流式 transport，依赖 cross-spawn）隔离到独立子路径；主入口 `.`（Client + SSE/streamable HTTP transport + jose + eventsource）经 vite 打包为 344 KB ESM 产物，**零 `require()`、零 `node:` 导入、零 cross-spawn/child_process**——browser 版经 exports 面引入即安全，无需补丁。深路径 import（如 `dist/esm/...`）不在 exports 白名单，会被 bundler 拒绝——业务代码一律走主入口与 `./stdio` 子路径。
