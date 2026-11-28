# @spherse/rpc

RPC 层：JSON-RPC 2.0 基座 + 事件扩展。envelope 契约在 `@spherse/contracts`（rpc.ts）。

## 入口分层

| 入口 | 内容 | 可用环境 |
|---|---|---|
| `.` | `RpcClient` / `RpcTransport` / `RpcCallError` | renderer（无 WS 依赖，transport 可插 postMessage） |
| `./methods` | 方法组基座 + `buildBaseMethodRegistry` | **browser-safe**（SharedWorker 直接打包） |
| `./host` | `RpcDispatcher` / `RpcConnectionHandler` / `defineRpcMethod` / `toAppError` / `registerRpcMethodGroups` + `./chat` hub | browser-safe（host 装配侧） |
| `./chat` | ChatSessionHub / ChatChannel / replay / projector | browser-safe |
| `./testing` | harness / `callMethod` / FakeProjectCtx | 测试环境（依赖 vitest） |

## 方法组放置判据（写死在 eslint 守门）

**`src/methods/` 基座必须 browser-safe**：零 `node:*` import（eslint `no-restricted-imports` 强制）。判据：

- 方法只依赖 `RpcContext` 抽象（`resolveProject` → PM/SessionManager/DataStore/FsPort 端口、`registry`、`modelSettings` 端口）→ **进基座**，server（Fastify WS）与 browser（SharedWorker）共用
- 方法需要平台专属机制（`process.env` 注入、zip 下载流、Blob structured clone 直传、绝对路径安装）→ **放宿主包**：
  - `packages/server/src/rpc/methods/`：skills（marketplace service env 覆盖）、marketplace（zip 下载/安装）
  - `packages/browser/src/worker/methods/`：skills（browser 版 manifest fetch）、attachments（Blob 直传）、browser.*（注册表）

宿主组经各自 registry 与 `buildBaseMethodRegistry()` 合并（重名即抛）。

## 契约测试

- 方法组测试统一用 `@spherse/rpc/testing` 的 `createRpcHarness` + `callMethod`（不 mock 被测方法本身）
- 双实现面（如 store、资源面）共用同一组语义测试；transport 两实现（WS / postMessage）行为分叉是仓库红线测试项
