<div align="center">

# Spherse

中文｜[EN](README.en.md)

**一个本地运行、开箱即用的个人 Agent 运行时。**

让多个拥有独立身份、权限、技能和自动化能力的 Agent，围绕同一个用户数据空间工作；再用 HTML 与 UI SDK，把 Agent 和数据组合成真正可交互的应用。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<img src="packages/landing/public/screenshots/carousel-2.png" alt="Spherse 应用截图" />

</div>

## Spherse 是什么？

Spherse 是一套让用户运行 Agent、管理本地数据并消费自制内容的基础设施。

在 Spherse 中：

- **项目目录是共享的数据空间**：普通文件就是用户的数据，始终保存在本地，可直接查看、编辑、复制和迁移。
- **Agent 是独立的执行者**：每个 Agent 都可以拥有自己的系统提示词、工具权限、私有 Skill、MCP Server、会话和聊天主题。
- **Session 是相互独立的任务上下文**：同一个 Agent 下可以创建多个会话，分别承载不同任务和历史。
- **Trigger 构成自动化网络**：Agent 可以按 Cron 定时运行，也可以响应自定义事件；用户页面或其他 Agent 都能发出事件。
- **HTML 是可运行的应用界面**：Spherse 可以直接托管并浏览项目中的 HTML，页面还能通过 UI SDK 读写数据、创建会话、发送消息和触发 Agent。

这使一个 Spherse 项目不只是一组聊天记录，而可以成为一个完整的 **Agent Workspace**：同时包含用户数据、Agent、Skill、自动化、主题和交互页面。

## 可以用它做什么？

Spherse 不预设唯一用途。一个项目可以是：

- 由多个角色持续维护的世界观与互动叙事空间
- 带仪表盘、日报和自动整理流程的个人记录系统
- 由研究、摘要和归档 Agent 协作的知识工作台
- 可通过事件联动的 AI 角色社区或文字游戏
- 用自定义 HTML 呈现的个人工具与数据应用

真正可复用和分发的单位不是一段 Prompt，而是包含 **数据结构 + Agent + Skill + 自动化 + UI** 的完整 Workspace。

## 下载与安装

前往 [Releases](https://github.com/mengrru/Spherse/releases) 下载最新版本：

- **macOS**：下载对应架构的 `.dmg` 文件并拖入“应用程序”
- **Windows**：下载 `.exe` 安装包并运行

> [!NOTE]
> 当前 macOS 版本尚未使用 Apple Developer 证书签名。首次打开时如果出现“已损坏”或“无法验证开发者”提示，请在终端执行：
>
> ```bash
> xattr -cr /Applications/Spherse.app
> ```

安装后配置一个受支持的 LLM Provider API Key，即可创建项目和 Agent。

## 核心能力

### 多 Agent，共享同一个数据空间

围绕一个项目创建多个分工不同的 Agent。它们共享项目文件，但各自拥有独立配置：

- 系统提示词与预载上下文
- 可用工具及文件访问权限
- 项目级共享 Skill、Agent 私有 Skill 与内置 Skill
- 独立的 MCP Server 连接
- 多个持久化 Session
- 独立聊天主题

### 事件驱动的 Agent 自动化

Trigger 让 Agent 不必等待用户发起聊天：

- 使用 Cron 表达式定时执行
- 响应带 payload 的自定义事件
- 在新 Session 或指定 Session 中运行
- 由用户、HTML 页面或其他 Agent 触发
- 保存执行状态与运行日志

### HTML + UI SDK：从内容到应用

Spherse 内置本地 HTTP Preview Server，可以直接浏览项目中的 HTML、图片和其他内容。用户页面可通过 UI SDK 调用运行时能力：

- `data.get` / `data.set` / `data.delete`：读写项目内 JSON 数据
- 创建 Agent Session
- 向指定 Session 发送消息
- 触发 Agent 自定义事件
- 打开项目文件或将内容显示为浮窗

由此可以形成完整闭环：

> Agent 生成或更新内容 → HTML 展示数据 → 用户交互 → 页面再次调用 Agent

### 整个 Workspace 都可以分发

Spherse 以项目目录作为完整的分发单元。复制或分享整个目录，其中的数据、Agent 配置、Skill、自动化规则、主题与交互页面都会一同保留。接收者在 Spherse 中打开后，得到的不是一份静态内容，而是一个可以直接运行、继续使用和自由扩展的 Agent Workspace。

### 本地优先，数据由用户掌控

- 项目内容以普通文件保存
- Agent 配置使用 Markdown、YAML 和 JSON
- Session 持久化在项目内的 SQLite 数据库
- AI 文件访问受路径分类与权限策略约束
- 文件工具具备路径穿越防护和并发写保护
- 危险操作需要用户明确批准

### 桌面运行，移动访问

Spherse 提供 macOS 和 Windows 桌面应用，也可以通过带访问令牌的 Web 客户端在移动设备上连接桌面运行时。Quick Tunnel 模式可自动建立 Cloudflare Tunnel，也支持用户自行配置公网入口。

## 本地开发

环境要求：Node.js 22.19+。

```bash
git clone https://github.com/mengrru/Spherse.git
cd Spherse
npm install
npm run dev
```

常用命令：

```bash
npm run build       # 构建所有 package
npm run verify      # lint、build、单元测试与 i18n 检查
npm run verify:e2e  # 完整检查 + Electron E2E
npm run dist        # 构建当前平台的安装包
```

项目采用 npm workspaces，主要由以下部分组成：

| Package | 职责 |
| --- | --- |
| `@spherse/core` | Agent、Session、Skill、Tool、Trigger 与本地数据运行时 |
| `@spherse/server` | Fastify HTTP/WebSocket API 与运行时契约 |
| `@spherse/app` | 桌面端与 Web 端共享的 React Renderer |
| `@spherse/desktop` | Electron 主进程、Preload、IPC 与桌面基础设施 |
| `@spherse/web` | 移动端 Web/PWA 宿主 |
| `@spherse/presets` | 内置模板、Skill 与示例内容 |
| `@spherse/i18n` | 国际化基础设施与翻译资源 |

详细架构与数据约定见 [`docs/official/`](docs/official/)，开发规范见 [`AGENTS.md`](AGENTS.md)。

## 技术栈

Electron · React · TypeScript · Fastify · pi-agent-core · pi-ai · MCP · SQLite · Zustand · Tailwind CSS

## License

[MIT](LICENSE)
