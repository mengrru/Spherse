# RPC envelope 选型调研（O4）

日期：2026-11-22
关联：dev-v2 架构设计 `docs/dev/infra/2026-11-21-plugin-runtime-rpc/design.md` 开放决策点 O4；前端 RPC 化开工前置

## 结论

**自研 envelope：基座对齐 JSON-RPC 2.0（call/result/error），事件面（sub/event/snapshot）自定义扩展。三个候选中 cordis 生态没有可复用的 RPC 包，该选项实际不存在。**

| 候选 | 结论 | 关键原因 |
|---|---|---|
| cordis 生态现成 RPC 包 | ❌ 不存在 | npm 无 `@cordisjs/rpc`；Koishi console 协议内嵌于 `@koishijs/console` + `@cordisjs/client`，Koishi/Vue 强耦合，未作为独立层发布 |
| 第三方通用 RPC（tRPC v11 等） | ❌ 净收益为负 | 校验体系绑 zod，与 contracts TypeBox 0.34 词表决策冲突；postMessage transport 反正要自写；subscription 无 seq/since/replay，事件层仍需自设计 |
| 自研（JSON-RPC 2.0 兼容 + 扩展） | ✅ 推荐 | 双端 <300 行/端；transport 与事件语义完全贴合 D5/D6/D7；与 cordis 零耦合 |

**重要副产品（修正架构设计的一个假设）**："cordis 成熟"需修正为分裂事实——**3.x 线生产验证但已冻结**（3.18.1，2024-09-17 后未再发版，Koishi 生产在用），**4.x 线活跃但 API 不稳定**（latest = 4.0.0-rc.13，2026-11-12 发布；README 明示 "The API is not yet stable and may change without notice"，官方文档 under construction）。自研 envelope 恰好把 RPC 面与 cordis 解耦：P1 引入 cordis 后其 API 变动不影响已落地的 RPC 契约与前端。**派生新决策点：P1 时选 3.x（冻结稳定）还是 4.x（活跃不稳），建议并入 O3 一起拍**。

## 事实链（npm / GitHub 实测，2026-11-22）

### 1. cordis 本体状态

- `cordis` dist-tags：`latest = 4.0.0-rc.13`，`next = 4.0.0-beta.5`；4.0 全程 3 alpha → 8 beta → 14 rc，未出 stable
- `cordis@3.18.1` 发布于 2024-09-17，此后 3.x 无新版本；`@koishijs/client` 5.30.11 依赖 `cordis ^3.18.1`（生产在用）
- repo 已迁至 cordiverse/cordis；README：API 不稳定声明 + 论文（arXiv:2608.25512）；官方文档托管在 deepseek-harness.github.io（项目活跃、有背书，但均处早期）

### 2. cordis 生态无 RPC 包

- `@cordisjs/rpc`：npm 404
- `@cordisjs/*` 全扫（npm search 25 包）：server-static / server-proxy / server-acl / plugin-http / timer / logger / schema / loader / hmr / cli 等，**无独立 RPC / transport 抽象包**
- Koishi console 共享插件协议的实际位置：`@koishijs/console` 5.30.11（"Console Service for Koishi"，服务端侧）+ `@cordisjs/client` 0.8.2（"Koishi Console Client"，dependencies 含 vue / element-plus / unocss / @vitejs/plugin-vue）+ `@koishijs/client`（Vue + cordis 3.18）——协议内嵌于 console 体系，client 侧与 Vue 组件栈强耦合，不可提取复用
- `@cordisjs/muon` 0.2.2（"Observe and serialize mutations on plain JavaScript values"）：类比 chord delta tracking 的状态序列化层，未来状态同步可参考，不是 RPC

### 3. tRPC v11 不适配点

- 类型推断（server 类型直通 client）与「contracts TypeBox 0.34 作 RPC 词表 + 双端运行时校验」的既定决策冲突；tRPC 生态校验绑定 zod，TypeBox 无一等支持
- browser 形态 transport 是 SharedWorker postMessage，custom link 必须自写——transport 抽象层反正自研，tRPC 只剩 client 类型直通一项收益，而该项与词表决策互斥
- subscriptions 为 Observable 语义，无 seq / since / replay，D7 的 replayable/live-only 双语义与断线续传仍需自设计
- 与 cordis 组合层的插件/服务模型理念重叠，两套体系争同一层

### 4. JSON-RPC 2.0 作基座的边界

- 覆盖：`call`/`result`/`error` 三原语、错误对象结构、id 关联——成熟、无发明
- 不覆盖（自定义扩展，明确命名空间）：事件订阅、replayable 回放边界、心跳、能力握手
- 明确不用：batch（无场景）、msgpack/二进制帧（大二进制不进 WS RPC——桌面上传走 multipart 资源面，browser 上传走 postMessage structured clone，天然支持 Blob）

## 推荐方案：envelope v1 草案

帧类型（JSON / UTF-8，单连接多路复用，复用现有 `WsConnection` 的重连/退避/心跳）：

| 帧 | 结构 | 说明 |
|---|---|---|
| `hello` | `{v, capabilities, appVersion}`（双向） | 能力矩阵 + version-compat 迁入点（D10） |
| `call` | `{id, method, params}` | method 命名 `group.method`，group 对齐 D9 插件权限边界（sessions / content / agents / settings / triggers / marketplace / …） |
| `result` | `{id, ok, data}` \| `{id, ok:false, error:{code, message, data?}}` | 错误码表落 contracts，映射 core 异常类型 |
| `sub` / `unsub` | `{id, scope}` / `{id, scope}`；sub 可带 `since` | scope = `channel:实体键`（chat 为 replayable，bus 五通道 live-only） |
| `snapshot` | `{id, events[]}` | replayable scope 订阅时先回放（源：event-log），随后转 live 推送 |
| `event` | `{scope, seq?, type, payload, ts}` | seq 仅 replayable scope 定义（per-scope 单调） |
| `ping` / `pong` | 空 payload | 参数语义沿用 bus WS 现行实现 |

Transport 接口（两实现共用契约测试，延续架构设计测试节）：`send(frame)` / `onFrame` / close / backoff；实现 = Fastify WS（桌面）+ SharedWorker postMessage（browser）。

校验：method registry `method → TypeBox schema`（contracts 词表）；server 端 params 强校验、result dev 校验；client 端对 event 与 result 校验（复用 contracts parser 面貌）。

与 cordis 的关系：**RPC 层零 cordis 依赖**。P1 cordis host 化时 service 方法直接挂 dispatcher，envelope 与前端均不变动。

## 回写架构设计的两项（待确认后随下次 commit）

1. O4 关闭：自研 envelope（JSON-RPC 2.0 基座 + 事件扩展），按上述草案
2. 风险表补一行 + 修正「cordis 成熟」论据：3.x 冻结 / 4.x RC API 不稳；派生决策「P1 选 3.x 还是 4.x」并入 O3
