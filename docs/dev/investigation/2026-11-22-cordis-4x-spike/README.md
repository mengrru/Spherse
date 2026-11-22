# Spike: cordis 4.x（rc.13）SharedWorker 验证与 O3 拍板材料

- 日期：2026-11-22
- 状态：**通过**（功能 8/8 dev 验证 + bundle 产物干净）
- 关联：`2026-11-22-cordis-sharedworker-spike`（3.18.1 版本，8/8）；`docs/dev/infra/2026-11-21-plugin-runtime-rpc/design.md` O3（3.x frozen vs 4.x）

## 验证结果

与 3.x spike 同一套 8 项断言（Chromium headless + vite dev）：全部功能项通过；introspect 项按 4.x 概念（`hasFiber:true` + `ctx.events` 存在）等价验证。生产构建（rollup 显式入口）：cordis 4.x 打为共享 lib chunk **31.04 kB**（3.x 为 ~65 kB 单文件），worker chunk 零 `node:` 导入、零 `require(`。

demo：`src/shared-worker-v4.ts`（`?v=4` 切换）。注意：`new URL(cond ? a : b, import.meta.url)` 三元在 vite build 不被重写为产物路径——生产验证用 `build.rollupOptions.input` 显式打包 worker 入口。

## API 面对比（实测，非文档转述）

| 维度 | cordis 3.18.1 | cordis 4.0.0-rc.13 |
|---|---|---|
| 生命周期 | `ctx.start()/stop()`，Scope 树（Main/Fork/Effect） | **Fiber-first**：`ctx.plugin(fn)` 返回 Fiber，无显式 start/stop |
| 副作用 | 隐式（scope dispose 级联） | `ctx.effect()`：Disposable / Generator / AsyncDisposable 显式模型 |
| 定时器 | `ctx.setInterval`（TimerService 内建） | 无内建；effect 内包 `setInterval` + 返回 cleanup（与手写一致） |
| 服务 | `ctx.provide()` + Service 基类 | 保留 `provide/inject`，Context 内建 `events/logger/reflect/registry` 服务 |
| Schema/config | `Schema` 内建 | 移除（独立包 + `@standard-schema/spec` 标准） |
| command | 无（独立包） | 无（独立包） |
| bundle | ~65 kB | ~31 kB |

## O3 拍板建议：**选 4.x**

理由：

1. **避免二次迁移**：3.x 在 4.0 stable 后进入维护线；3→4 API 断层大（上表），P1 插件代码量决定现在选哪版就绑死哪版，3.x 等于预支一笔未来迁移债。
2. **我们的使用面浅**：插件注册 + 服务注入 + 事件 + 生命周期，不碰 Schema/config/command/console——rc 阶段 API 变动命中我们面的概率低，跟进成本低（锁精确版本 + pnpm 更新时 diff）。
3. **effect 模型更契合插件 cleanup 语义**（Disposable 显式化），且 bundle 减半对 browser 版（SharedWorker 内 host）有直接收益。
4. 两版 SharedWorker 兼容性均已实测通过，不构成区分项。

风险与缓解：

- **rc API 变动**：锁 `4.0.0-rc.13` 精确版本；P1 的 host 层把 cordis 类型/符号收敛在 `packages/core` 的 host 模块内（业务插件不直接 import cordis），rc 升级只改 host 一处。
- **4.x 文档/生态未跟上**：Koishi 生态主体仍在 3.x；我们的场景自包含，不依赖生态插件。
- 若拍板时 4.0 已出 stable，直接锁 stable。

反方案（3.x frozen）成立条件：仅当 P1 排期与 4.0 stable 发布窗口冲突且需要即刻冻结依赖——当前无此约束。
