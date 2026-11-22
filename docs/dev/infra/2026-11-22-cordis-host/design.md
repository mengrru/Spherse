# Design: cordis host 引入（P1 主体）

- 日期：2026-11-22
- 状态：reviewed（2C/4I/4M/2m 已处理，见文末记录）
- 关联：`docs/dev/infra/2026-11-21-plugin-runtime-rpc/design.md`（P1、O3 已拍板 cordis 4.x）；`docs/dev/infra/2026-11-22-storage-port-abstraction/design.md`（D-S2 步骤 2：store service 桥）；API 实测：`docs/dev/investigation/2026-11-22-cordis-4x-spike/`

## 1. 目标与非目标

**目标**：core 引入 cordis 4.x 作为组装宿主——capability 插件化（现有 `Capability` 对象包装为 cordis 插件）、核心服务注册为 ctx service、`ProjectRuntime` 暴露 host 引用。**桌面行为零变化**（全量 verify 零回归 + 指定 e2e 场景集全绿）。

**非目标**：
- 不改 Capability 接口本身与各 capability 实现
- 不做方法组/插件系统全面收敛（REST/RPC 方法组变插件归 P1 后半）
- 不做 browser 面（P3）；BackendPort 不动（P1 红线）
- 不引入 cordis Schema/config 面与 console 生态

## 2. 形态（决策 D-H1：宿主内嵌，组装函数成为唯一入口）

`assembleProject` 内部创建 cordis Context 作为宿主；`ProjectRuntime` 新增 `readonly host: HostContext`。不暴露"先建 ctx 再组装"的两段式 API——单入口保证**服务注册顺序确定**（失败路径与现状同样不做回滚，装配非事务性）。调用方（server/desktop）对 cordis 无运行时依赖、无需 import cordis；`host` 字段为 type-only 暴露。

Host context 生命周期 = ProjectRuntime 生命周期：**每项目一个独立 context**（不做跨项目共享 root），`ProjectRuntime.shutdown` 内销毁；server registry 反复 register/remove 项目即反复建/销 host，无全局状态残留。

## 3. Host 模块与依赖收敛（决策 D-H2）

`packages/core/src/host/`：

- `context.ts`——**全仓库唯一 `import ... from "cordis"` 处**（红线）。导出：
  - `HostContext`（= cordis `Context` 类型别名）、`HostFiber` 类型
  - `HostServiceKey` 常量对象：`fs = "spherse/fs"`、`logger = "spherse/logger"`、`fileWriteMutex = "spherse/file-write-mutex"`、`projectStore = "spherse/project-store"`、`stores = "spherse/stores"`、`data = "spherse/data"`、`sessionStoreFactory = "spherse/session-store-factory"`、`memoryStoreFactory = "spherse/memory-store-factory"`、`capabilities = "spherse/capabilities"`
  - `createHostContext(): HostContext`
- `services.ts`——`registerCoreServices(host, deps)`：`ctx.provide(key, value)` 注册上表服务；**禁止注册 undefined**——factory 类服务（sessionStore/memoryStore）缺省时注册解析后的 Node 默认工厂（包装 `new SqliteSessionStore(...)` / `new SqliteMemoryStore(...)` 的函数，与 AgentStore 注入链的默认分支同构）。`CapabilitiesService` = 现有 `CapabilityRegistry` 实例复用
- `capability-plugin.ts`——`defineCapabilityPlugin(capability, kernelServices)`：返回 `{ plugin, ready }`：
  - `plugin = (ctx) => { registry.register(capability); if (capability.init) await capability.init(kernelServices); }`（注册型插件，不注册 effect——shutdown 语义见 D-H3）
  - `ready: Promise<void>`——wrapper 内部 resolve/reject 承载 init 结果；不依赖 cordis fiber 错误传播（实测 4.x FAILED 状态可见但错误对象不可读，自管 promise 规避 rc API 细节）

业务/后续插件一律 `import type { HostContext } from "@spherse/core"` + `ctx.get(HostServiceKey.fs)` 取服务，不直接 import cordis（O3 风险缓解落地）。

**未经 spike 验证、由本设计单测首证的 cordis 4.x API**（I2，实现时先写探针测试）：
- `new Context()` 作为 4.x root 入口 + 空 options 构造
- root 上 `ctx.provide` 后子 fiber 内 `ctx.get` 可见性（时序安全）
- fiber 逐个 `dispose()` 的状态迁移与重复 dispose 容错

## 4. capability 插件化映射（决策 D-H3：注册提前 + 串行 init + shutdown 保持显式循环）

| 现状 | 插件化后 |
|---|---|
| `capabilities: Capability[]` 纯数组，`createRuntimeDeps` 直接消费数组 | **不变**——kernel 继续消费数组（`createRuntimeDeps` 签名零波及）；`CapabilityRegistry` 现状在装配路径**零使用**（仅定义与单测），本设计将其启用为 host 侧服务视图 |
| 数组无查重（重复 id 静默接受、两份都生效） | 保持：registry 注册处 `try register catch ConflictError → logger.warn 跳过后注册者`（host 视图取首个；数组行为与现状一致，装配不因病态输入失败） |
| `for...of` 串行 `await capability.init()`，失败即停（后续不 init）、已 init 者无清理 | **完全保持串行**：逐个 `host.plugin(w.plugin)` → `await w.ready` → 下一个。失败路径与现状**同等弱**（不调用已 init capability 的 shutdown）；此时对已 settle 的 fiber 逐个 `dispose()`（try/catch 包裹，**仅 fiber 状态卫生而非资源清理**——dispose 不取消飞行中的 init promise，副作用清不掉） |
| `ProjectRuntime.shutdown` 显式循环 `capability.shutdown?.()`（settleWithin 5s 超时保护） | **不变**。插件不注册 effect、shutdown 不映射到 fiber dispose——超时保护与顺序是既有行为 |
| （registry 无流转） | 装配第 6.5 步解析数组后**同步** `registry.register(cap)`（早于 createRuntimeDeps 与插件启动），`spherse/capabilities` 服务即可供未来插件消费 |

## 5. 服务面（第一批最小集，决策 D-H4）

注册"后续插件可消费且当前已存在"的服务：fs / logger / **fileWriteMutex**（存储设计契约注 4：DataStore ifVersion 乐观锁依赖 mutex 单实例，插件直写文件必须可拿到同一 mutex）/ projectStore / **stores**（kernel 的 SessionStoreRegistry）/ data / sessionStoreFactory / memoryStoreFactory（默认解析，禁 undefined）/ capabilities(registry)。

不注册：PM、sessionRuntime（经 `ProjectRuntime` 字段直达，无消费者，P1 后半方法组插件化时再评估）；modelCatalog/runConfig（BackendPort 域，红线不动）。

## 6. 装配时序（assembleProject 改造后）

```
1. fileWriteMutex / fsPort / projectStore / dataStore（不变）
2. projectStore.open / create / initPresets（不变）
3. projectManager = new ProjectManager(...)（不变）
4. stores = createStoreRegistry(logger)（不变）
5. host = createHostContext()
6. capabilities 列表解析（options.capabilities 兼容不变）
6.5 registry = new CapabilityRegistry()；逐个 register（ConflictError → warn 跳过）
7. registerCoreServices(host, { fs, logger, fileWriteMutex, projectStore, stores, data,
   sessionStoreFactory（默认解析）, memoryStoreFactory（默认解析）, capabilities: registry })
8. runConfig / deps = createRuntimeDeps({ ..., capabilities: <数组> })（签名与消费不变）
9. sessionRuntime / sessionPort（不变）
10. kernelServices 构造（projectRoot/metaDir/logger/fileWriteMutex/stores/session——与现状 init 入参同构）
11. for (cap of capabilities) { w = defineCapabilityPlugin(cap, kernelServices);
     fibers.push(host.plugin(w.plugin)); await w.ready; }   ← 串行，失败即停并进入失败清理
12. 失败清理：已 settle fiber 逐个 dispose（try/catch）→ 重抛原错误
13. return new ProjectRuntime({ ..., host, capabilities: <数组> })
```

`ProjectRuntime.shutdown`：现有顺序（sessionRuntime.closeAll → capability.shutdown 循环 → projectManager.close）执行完后逐 fiber `dispose()`（best-effort）。

## 7. 依赖与版本

`packages/core/package.json` 增加 `"cordis": "4.0.0-rc.13"`（精确锁，O3 决策）；升级时 diff `host/context.ts` 的 API 面即可评估影响。

## 8. 验收

- 全量 verify（lint/build/typecheck/core+server+rpc+app 单测）零回归
- 指定 e2e 场景集全绿（agent-dialog + rpc 场景）
- 新增 host 单测：
  - cordis API 探针（§3 列出的三项未证断言）
  - 服务注册与取用（含 factory 默认解析、无 undefined 服务）
  - capability init 成功路径（串行顺序断言：init 依次完成）
  - init 失败传播（失败 → createProject reject；**失败点之后的 capability 未 init** 断言）
  - 重复 id warn 跳过（host 视图取首个，数组两份都在）
  - `ProjectRuntime.host` 可达；shutdown 后 fiber 全 DISPOSED
- 现有测试文件**零 diff**（如不可达，逐文件列 diff 与理由）

## 9. 风险表

| 风险 | 缓解 |
|---|---|
| cordis rc API 变动（Fiber 状态/错误面/root 构造） | 错误传播自管（ready promise）；host 模块唯一 import 点；锁精确版本；§3 未证断言单测首证 |
| dispose 飞行中 fiber 的行为未知 | 失败清理仅 dispose 已 settle fiber + try/catch；"dispose ≠ 取消"写入 §6 注 |
| 数组与 registry 双源真相 | kernel 以数组为真相（签名不变）；registry 是 host 视图且注册先于一切消费；一致性由装配顺序保证（6.5 早于 8/11） |
| 重复 id 行为从静默变冲突 | warn 跳过策略保持静默等价（§4） |
| plugin async fn 在 ready 前被外部 dispose | 单测覆盖 dispose 容错；第一批注册型插件 dispose 无资源语义 |
| services factory undefined 踩空 | 默认解析注册（禁 undefined），单测断言 |

## Review 处理记录（2026-11-22）

- **C1**：registry 现状勘误（装配路径零使用）；采纳方案 a'——数组保持 kernel 真相（`createRuntimeDeps` 签名零波及），registry 启用为 host 侧视图且**注册提前到 6.5 步**（早于 createRuntimeDeps 与插件启动），时序矛盾消除。✅
- **C2**：init 保持**严格串行**（逐 plugin → await ready → 下一个，等价现状 for-await）；失败清理如实降级为"已 settle fiber 状态卫生（try/catch），非资源清理"，与现状同等弱声明。✅
- **I1**：§6 补 projectManager（步 3）与 stores（步 4）。✅
- **I2**：§3 列出三项未证 API（root 构造 / provide→get 跨 fiber 可见性 / dispose 容错），单测首证。✅
- **I3**：服务面补 `fileWriteMutex` 与 `stores`。✅
- **I4**：重复 id 采 warn 跳过（静默等价），验收补冲突路径用例。✅
- **M1-M4**：dispose 仅 settle fiber + try/catch（M1）；factory 默认解析禁 undefined（M2）；验收措辞可测化 + 串行断言（M3）；"原子性"措辞收敛为"注册顺序确定"（M4）。✅
- **m1/m2**：文档移至 `docs/dev/infra/`（原误落 packages/core/docs/）；"零感知"改为"无运行时依赖、无需 import cordis"。✅
