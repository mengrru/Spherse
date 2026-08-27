# ADR-0007：API 契约 schema 进代码（contracts + parseContract）

- 状态：accepted
- 日期：2026-06-09（引入）；bus / data / marketplace 等后续路由逐步收敛
- 影响：`packages/server/src/contracts/`、全部 HTTP route 与 WS 边界、renderer API client

## 背景

HTTP / WebSocket 边界曾靠裸 `JSON.parse` 与 TypeScript 泛型：类型只在编译期存在，运行时对畸形负载零防御；client 与 server 各写一份 shape，漂移无人发现。

## 决策

- request / response 与 WS message 的运行时 schema 统一定义在 `@spherse/server/contracts`（typebox）
- server route、renderer API client、WebSocket 边界复用同一套 schema / parser（`parseContract`），不新增裸 `JSON.parse`
- 新路由绑定 Fastify schema option，契约缺口在 review 中显式登记

## 后果

- 正：边界校验单点维护，client / server 同源，畸形负载在边界被拒
- 负：每个新端点多一步 schema 定义；存量路由收敛是持续债（见 backlog「server 契约缺口」）

## 原始记录

- `docs/dev/features/2026-06-09-chat-streaming-resilience/`（contracts 随 WS 韧性工作引入）
- `docs/dev/infra/2026-06-21-bus-ws-refactor/`
