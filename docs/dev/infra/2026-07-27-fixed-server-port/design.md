# 固定 Server 默认端口（带占用回退）

## Overview

将 `@spherse/server` 的监听端口从「每次启动由 OS 分配随机端口」（`port: 0`）改为「固定一个不常见的默认端口 `53972`，仅当该端口被占用时才回退到 OS 分配的随机端口」。

固定端口便于排查、调试、隧道重连场景的稳定性，同时保留占用回退以保证启动永不因端口冲突失败。

## 背景

当前 `packages/server/src/index.ts` 中：

```ts
await fastify.listen({ port: 0, host: "127.0.0.1" });
```

`port: 0` 让 OS 每次分配一个临时端口，desktop 通过 `getServerPort()` 回读实际端口，再分发给 tunnel manager 与 renderer。该机制工作正常，但端口不固定，带来：

- 排查/调试时无法预知端口
- 隧道、移动端访问等场景端口每次变动
- 日志中端口值无规律

## 方案

### 常量与 API

- `packages/server/src/index.ts` 导出 `DEFAULT_SERVER_PORT = 53972`
- `CreateServerOptions` 新增可选字段 `port?: number`，缺省取 `DEFAULT_SERVER_PORT`

`port` 选项存在的理由：让 listen/回退逻辑可被单元测试干净地覆盖（测试可注入任意端口构造占用/空闲场景），并非为投机性的用户配置预留。

### Listen 带回退逻辑

将 `fastify.listen({ port: 0, ... })` 替换为：

```ts
const preferred = options?.port ?? DEFAULT_SERVER_PORT;
try {
  await fastify.listen({ port: preferred, host: "127.0.0.1" });
} catch (err) {
  if (err?.code !== "EADDRINUSE") throw err;
  logger.warn({ port: preferred }, "default port in use, falling back to OS-assigned port");
  await fastify.listen({ port: 0, host: "127.0.0.1" });
}
```

- 仅 `EADDRINUSE` 触发回退；其它绑定错误（如权限问题）正常抛出
- 保留既有 `logger.info({ port: address.port }, "server listening")`，实际绑定端口始终被记录
- 回退时额外输出 `warn`，说明发生了回退以及原本期望的端口

### Desktop 侧：无需改动

`packages/desktop/electron/server.ts` 的 `getServerPort()` 已经从 fastify 实际地址回读端口，tunnel manager、移动端访问、renderer 都自动拿到正确端口（无论是默认端口还是回退端口）。

## 端口选择依据

`53972` 位于 IANA 动态/私有端口范围（49152–65535），该范围明确不分配给任何已注册服务，与常见开发工具（3000/5173/8000/8080/9000 等）碰撞概率极低。

## 测试

新增 `packages/server/src/__tests__/create-server.test.ts`：

1. **Happy path**：用 `net.createServer().listen(0)` 申请一个空闲端口 → 关闭 → 传给 `createMultiProjectServer({ port })` → 断言实际绑定端口等于该端口 → 关闭
2. **Fallback path**：用一个 dummy listener 占据端口 P → `createMultiProjectServer({ port: P })` → 断言实际绑定端口 ≠ P（OS 分配）→ 关闭两个 server

不直接断言字面量 `53972`，避免并行测试间冲突；默认常量由上述逻辑测试间接覆盖。

## 文档

- `docs/official/` 无文件描述端口机制，无需同步
- `docs/dev/` 下历史文档中「随机端口」描述按 AGENTS.md 约定允许过期，不更新

## 范围外（YAGNI）

- 用户可配置端口（设置项）
- 固定回退端口列表 / 自增端口尝试
- 端口在 UI 上的展示
