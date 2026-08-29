# @spherse/contracts

跨进程边界的 wire 协议包：HTTP / WebSocket（未来含 IPC）的可序列化数据契约 + 运行时校验。server route、renderer API client、WS 边界复用同一套 schema / parser，是 `@spherse/server` 与 `@spherse/app` 的双侧共享协议。

- 契约进代码的由来见 [ADR-0007](../../docs/dev/decisions/0007-contracts-in-code.md)
- 运行时依赖仅 `@sinclair/typebox`；对 `@spherse/core` 仅 type-only 引用（wire 协议保持 payload-agnostic 的 `Type.Unsafe<T>` 标注）
- **定位边界**：只放跨进程传输的数据契约。in-process API 接口（如 app 的 `HostBridge`）不属于本包

## 文件组织

`src/` 按业务域一文件（`agents.ts`、`sessions.ts`、`websocket.ts`、`bus.ts` 等），与 server 的 `routes/` 同名文件一一对应；`src/index.ts` 聚合所有 `schemas` 与类型 re-export，是包唯一入口，新增域时在此处追加 import / spread / type re-export。

## Schema 定义规范

- **库**：`@sinclair/typebox` 的 `Type.*` 构造器。所有 schema 为 `Type.Object` / `Type.Array` / `Type.Union` 等纯数据描述，可同时用于运行时校验和类型推导（`Static<typeof schema>`）。
- **命名**：资源 + 操作风格，无 HTTP 动词前缀。例如 `agentCreateRequest`、`agentCreateResponse`、`sessionListResponse`、`scheduleUpdateRequest`。`Request` 后缀表示入站 body，`Response` 后缀表示出站 payload，列表用 `*ListResponse`。
- **可选字段**：frontmatter 透传字段（如 `createdAt`、`model`）一律 `Type.Optional(...)`，因 core 的 store 不会保证所有文件都写出该字段。
- **`Type.Unknown()` 使用约束**：仅用于承接 pi-ai/pi-agent-core 复杂嵌套对象（chat 事件的 `message`/`args`/`result`、debug 的 `messages`/`parameters`、session messages）。这类字段只做结构校验，不强行 schema 化。逐步精确化的优化项见 `docs/dev/backlog.md`。
- **导出**：每个 contract 文件导出 `schemas` 对象（runtime schema 集合）+ `Static<>` 派生类型。`index.ts` 负责 re-export。

## 导出面规则（仓库「只导出被消费符号」红线的本包例外）

本包导出面镜像**契约面**而非消费面：schema 被 route / WS / bus 绑定即是使用，其派生类型名与消息 parser 是 wire 协议的词汇，**全集导出**，不因「当前无 TS 消费方 import」而裁剪——consumed ≠ used，裁剪派生名不删任何死代码，只给未来消费方制造求导出摩擦。孤儿 schema 的检出交给「contracts 与 routes 一一对应」组织规则与契约测试，不靠导出裁剪。

边界：域 `schemas` 集、`Static<>` 派生类型、消息 parser、wire 上出现的常量（错误码、close code 等）属词汇，在例外内；与 wire 词汇无关的通用 helper 仍适用仓库红线（只导出被消费符号）。

## 契约测试

新增 / 修改 schema 后补 `src/__tests__/` 对应用例，确保正向样本通过、负向样本抛 `Invalid payload`。测试以 Fastify 实例验证 schema 的 body coercion 兼容性（fastify 为 devDependencies，仅测试消费）。

## 开发

```bash
npm run dev -w @spherse/contracts    # tsc --watch
npm test -w @spherse/contracts       # vitest
npm run lint -w @spherse/contracts   # eslint
```
