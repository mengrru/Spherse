# 架构总览

> 覆盖：Spherse 全局架构、package 边界与依赖方向、组合根链。
> 本文件回答「系统由什么组成、谁装配谁」；各域机制进入同目录对应文件，按任务路由查 [`../README.md`](../README.md)。
> 各 package 的目录级细节见 [`../project-structure.md`](../project-structure.md)。

## 系统简述

Spherse 是本地运行的个人 Agent 运行时：多个拥有独立系统提示词、工具权限、Skill、MCP 与自动化能力的 Agent 围绕同一用户数据空间工作，并通过 HTML 与 UI SDK 构建可交互的 Agent Workspace。基于 Electron + React + Fastify，Agent 运行时为 pi-agent-core，LLM Provider 为 pi-ai。

## Package 边界

| Package | 职责 |
|---|---|
| `core` | 纯 Node.js 核心逻辑（微内核 + Capability）：项目数据、agent、session、skill、tool、运行时；零 Electron / Fastify 依赖 |
| `contracts` | 跨进程边界 wire 协议：HTTP / WS 的 typebox schema + parser，server 与 renderer 共同依赖 |
| `presets` | 预置模板与静态内容，构建期经 sync 脚本生成可导入常量（builtin skill 源码、预置 agent；提示词模板已迁往 spherse-assets 提示词模板市场，经 OSS 下发） |
| `i18n` | locale catalog 与翻译纯函数（`.`）+ React 绑定（`./react`） |
| `server` | Fastify API 层：HTTP / WS 边界、ProjectRegistry——薄转发层，含少量编排逻辑（ChatSessionHub 会话编排、错误分级） |
| `sdk` | 被注入 iframe 的浏览器运行时（`window.spherse`），esbuild 单文件 IIFE |
| `app` | 共享 React renderer：路由、feature UI、查询缓存、UI SDK host 桥 |
| `desktop` | Electron 桌面壳：main / preload / 生命周期，最终组合根所在 |
| `web` | 移动端 PWA 壳：`WebHostBridge`，经公网地址连接桌面 server（quick 模式 tunnel 或 manual 自填域名） |
| `landing` | GitHub Pages 项目介绍页（复用 `@spherse/i18n` 的类型与 locale 工具，自建 catalog） |

依赖方向单向收窄：

```
desktop / web（壳）
   └→ app（renderer）→ contracts / server → core
叶子库被上层按需引用：presets → core 与 app；sdk → app 与 server；i18n → app、desktop、web 与 landing。
```

## 前端三壳复用

renderer 单份代码经 `HostBridge` 抽象在桌面与 Web 复用：desktop 提供 `ElectronHostBridge`（IPC 全能力），web 提供 `WebHostBridge`（HTTP 子集）；`HostCapabilities` 声明能力开关，renderer 据此条件渲染宿主专属 UI。机制见 [frontend.md](frontend.md)。

## 组合根链

```
desktop main
  → migrateLegacySettings()（幂等拆分旧 settings + 应用 theme）
  → ensureServer({ modelSettingsPath, auth: { accessToken: getServerToken() } })
  → createMultiProjectServer()
      → ModelCatalog（server 自建）
      → ModelSettingsStore（load model-settings.json → env 注入 → custom providers 注册）
      → ProjectRegistry（以 store 中 defaultModel/sampling/thinkingLevel 构造）
          → assembleProject（core 组合根：store → PM → SessionManager → capability init）
```

- model catalog 与模型配置所有权在 server（desktop 只注入 `modelSettingsPath` 与 token）；见 [ADR-0015](../../dev/decisions/0015-settings-partitioned-persistence.md)
- web 壳不是组合根：它经 HTTP / WS 连接桌面 server，本地只持有连接信息与 locale 偏好
