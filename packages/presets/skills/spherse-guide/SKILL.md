---
name: spherse-guide
description: 当用户询问 Spherse 是什么、能做什么、如何开始或如何使用项目、Agent、会话、工具、Skill、MCP、触发器、HTML Workspace、数据应用、主题、图片、移动端与设置时使用；提供准确的产品能力介绍
---

# Spherse 使用指南

Spherse 是一个本地运行、开箱即用的个人 Agent 运行时。一个普通文件夹就是一个项目，多个拥有独立提示词、工具、Skill、MCP、自动化和会话的 Agent 围绕同一份用户文件协作。Agent 还可以生成 HTML 页面，并通过 UI SDK 把文件、会话和数据能力组合成可交互的 Workspace。

## 核心概念

### 项目

项目就是用户磁盘上的普通文件夹：

```text
project-root/
├── AGENTS.md
├── CHANGELOG.md
├── 用户文件...
└── .spherse/
    ├── project.yaml
    ├── theme.css
    ├── skills/
    └── agents/
```

- 普通文件是项目主体，可继续使用外部编辑器和版本控制管理。
- `AGENTS.md` 是所有 Agent 共享的项目指令。
- `CHANGELOG.md` 可由启用了 `append_changelog` 的 Agent 追加记录。
- `.spherse` 保存项目 ID、Agent、会话、主题、Skill、MCP、触发器等平台元数据。
- 桌面端可以同时打开多个项目，并从左侧项目头像切换。

### Agent

每个 Agent 都有独立的：

- 名称、别名和 system prompt
- 启用的工具
- 预加载上下文文件
- 会话历史
- 聊天主题
- MCP 连接器
- 触发器
- 私有 Skill 和记忆数据

Agent 创建界面可配置 Prompt、工具、上下文文件、时间感知、聊天主题和 YOLO 模式。工具必须显式启用；未启用的工具不会交给模型。

### 会话

同一个 Agent 可以拥有多个互相独立的会话。用户可以：

- 新建、打开、重命名、删除和导出会话
- 查看流式回复、工具调用、文件 diff、命令输出和 token 使用
- 中止正在生成的回复或重试失败的回复
- 回答 Agent 的问题，批准或拒绝危险操作
- 在桌面端将一个会话浮动为可拖拽窗口
- 在文档中划选文字，附带来源发送给现有会话或新 Agent

切换页面不会终止后台运行。一个会话同一时间只能执行一个 turn；忙碌时不会排队第二条消息。

## 功能地图

### 项目文件与内容浏览

桌面端 Files 区域支持浏览、新建、编辑、保存、删除文件和目录，也可以复制项目相对路径或将文件打开为多个浮窗。

Content Browser 支持：

- Markdown 与 YAML frontmatter
- HTML 预览和源码切换
- 图片预览
- 普通文本编辑与搜索
- 外部文件变化自动刷新
- 二进制文件交给系统默认应用打开

用户可在 Files 区域配置“AI 读取限制”，禁止 Agent 读取和写入指定项目路径。该策略不限制 `run_command` 启动的子进程。

### 项目欢迎页

项目根路由可以展示一个自定义 HTML 页面或图片（`html`、`png`、`webp`、`svg` 等常见格式），适合作为项目首页、导航入口、仪表盘或世界观导览。

配置方式：左侧活动栏右键当前项目头像 →「设置 → 欢迎页」→ 填写项目内相对路径。清空配置可恢复默认；未显式配置时自动尝试项目根目录的 `index.html`。欢迎页文件被修改后会自动刷新；文件缺失或加载失败时回退到默认空状态。

### 工具与审批

常见工具类别：

| 目的 | 工具 |
|---|---|
| 文件读取 | `read_file`、`list_files`、`search_content` |
| 文件修改 | `write_file`、`edit_file`、`move_file`、`copy_file` |
| 结构化数据 | `read_data`、`query_data`、`mutate_data` |
| 交互与展示 | `ask_user`、`render_card`、`generate_image` |
| 项目协作 | `append_changelog`、`load_skill`、`emit_trigger_event` |
| 记忆 | `memory_save`、`memory_recall` |
| 高级操作 | `run_command`、`manage_agent`、`manage_trigger` |

`run_command` 以及 `manage_agent` / `manage_trigger` 的写操作通常需要用户审批。`run_command` 以当前系统用户权限执行，没有 OS 级沙箱，文件访问限制也不约束其子进程；只应批准可信命令。YOLO 模式会跳过逐次审批，应谨慎启用。

### Skill

Skill 是 Agent 按需加载的工作说明或领域知识。system prompt 只注入 Skill 名称和描述，Agent 需要时通过 `load_skill` 读取正文，从而避免持续占用上下文。

Skill 分三层：

```text
agent-level > .spherse/skills > .agents/skills > builtin
```

- builtin：随 Spherse 发布，升级应用时更新
- project：主目录 `.spherse/skills/{name}/SKILL.md`，兼容载入 `.agents/skills/{name}/SKILL.md`
- agent-level：`.spherse/agents/{agent-slug}/skills/{name}/SKILL.md`

桌面端 Skills 区域可以浏览、创建和编辑项目 Skill，也可以从 ZIP 安装。创建自定义 Skill 时加载 `spherse-create-skill`。

当前专项内建 Skill：

- `spherse-create-ui-theme`：项目 UI 主题
- `spherse-create-agent-chat-theme`：Agent 聊天主题
- `spherse-use-ui-sdk`：HTML 中使用 `window.spherse`
- `spherse-build-data-app`：页面与 Agent 共同参与的数据应用
- `spherse-write-html`：生成 Spherse HTML 页面
- `spherse-create-skill`：创建自定义 Skill

### MCP 连接器

桌面端可从 Agent 右键菜单打开“连接器（MCP）”，为该 Agent 配置：

- stdio
- Streamable HTTP
- SSE

MCP 在首次向会话发送消息时懒连接，多个会话共享该 Agent 的连接。Server 提供的工具、instructions、resources 和 prompts 会合并到 Agent 能力中。单个 Server 连接失败不会阻断其他 Server。

MCP Server 可能执行本地程序或接收敏感 headers/env，只配置可信服务。配置保存在 Agent 的 `mcp.json`，LLM 文件工具不能读取它。

### 触发器与自动化

桌面端可从 Agent 右键菜单进入“触发器”，创建：

- 时间触发器：按 cron 周期执行
- 事件触发器：响应 HTML UI SDK 或 Agent 发出的自定义事件

触发器支持立即运行、启停、日志、完成通知，以及三种会话策略：复用专用会话、每次新建会话、发送到指定现有会话。

自动化依赖桌面端运行时，桌面应用关闭后不会独立执行。用户自定义事件名不能使用平台保留的 `sp:` 前缀。

### 记忆

每个 Agent 拥有跨会话的持久记忆，适合保存用户偏好、约定和长期上下文：

- Agent 用 `memory_save` 追加、`memory_recall` 检索记忆
- 最近的记忆会自动注入后续会话，无需每次重读
- 记忆是 Agent 私有的，保存在该 Agent 自己的目录下

### HTML Workspace 与 UI SDK

HTML 可作为项目欢迎页、Content Browser 页面或聊天 HtmlCard。Spherse 会自动注入 `window.spherse`，页面不需要加载 SDK 脚本，也不应手写 `postMessage` wrapper。

HTML 可以：

- 打开项目文件或会话
- 创建会话、向会话发送消息
- 弹出 toast
- 触发 Agent 自动化事件
- 读取只读的项目、Agent、会话和文件信息
- 读写 `*.data.json`
- 订阅文件变化

只有聊天 HtmlCard 能通过 `spherse.runtime` / `getRuntime()` 获得当前 `projectId`、`agentId` 和 `sessionId`；欢迎页和普通文件预览没有会话上下文。

生成或修改 HTML 前加载 `spherse-write-html`，查询 SDK 细节时加载 `spherse-use-ui-sdk`。

### 数据应用

页面和 Agent 可以围绕同一个 `*.data.json` 协作。推荐为增长型数据内嵌 `$manifest`，声明业务命名的 query 和 mutation：

- 页面用 `spherse.data.mutate`
- Agent 用 `query_data` / `mutate_data`
- 两者共享同一 mutation 和原子写入通道

这样可以避免 Agent 每次读取整个 JSON 浪费上下文，也能通过字段校验、自动 ID/时间和 item 级 mutation 提升写入准确性。构建论坛、任务板、模拟经营等数据型应用时加载 `spherse-build-data-app`。

### 主题

三类外观设置：

- 应用外观：设置中选择浅色、深色或跟随系统
- 项目主题：`.spherse/theme.css`，作用于整个项目工作区
- Agent 聊天主题：`.spherse/agents/{slug}/theme.css`，作用于该 Agent 的主聊天和浮动聊天

项目主题和 Agent 主题支持热重载。创建主题时使用对应内建 Skill，不要猜测 CSS token 或 `data-*` 选择器。

### 图片附件与图片生成

两种能力不要混淆：

- 聊天图片附件：用户上传图片作为模型输入，是否能理解取决于所选文本模型是否支持视觉输入。
- `generate_image`：Agent 调用图片 Provider 创建新图片，需要在设置中配置图片模型和 API Key。

生成图片会保存到 `.spherse/generated-images/` 并显示为聊天卡片，桌面端可将其导出到项目目录。

### 移动端 Web

桌面端「设置 → 移动端」可启用远程访问：Quick 模式通过 Cloudflare Quick Tunnel 提供地址和二维码，Manual 模式自行配置反向代理和公开域名。手机端可远程聊天、浏览 Agent、会话、文件和 HTML。

Web 端不是独立运行时（桌面应用必须保持运行），且主要是聊天与只读浏览，不提供项目创建、Agent/MCP/触发器管理、文件编辑等管理能力。URL、token 和二维码都是访问凭据，不应公开分享。

### 设置与调试

全局设置包括文本模型与 Provider API Key（含自定义 OpenAI-compatible Provider）、temperature/top-p、图片模型、语言外观、移动端访问和版本更新。

Debug Tools（开发模式直接可用，生产版从设置开启）提供 DevTools、renderer reload、流式日志、Turn Context 下载等。调试导出可能包含 system prompt、会话和项目内容，应视为敏感数据。

## 按目标推荐路径

| 用户目标 | 推荐路径 |
|---|---|
| 让 Agent 阅读和维护现有资料 | 打开资料目录 → 创建 Agent → 配置 Prompt、文件工具和上下文文件 → 新建会话 |
| 建立不同职责的协作团队 | 创建多个 Agent → 分别配置职责、工具和 Skill → 让它们围绕同一项目文件工作 |
| 固化重复工作方法 | 创建 project 或 agent-level Skill → 为相关 Agent 启用 `load_skill` |
| 让 Agent 记住用户偏好或长期约定 | 为 Agent 启用 `memory_save` / `memory_recall` → 让它在会话中保存与检索记忆 |
| 接入外部系统或工具 | 从 Agent 右键菜单配置可信 MCP Server |
| 定时执行或响应页面事件 | 创建时间/事件触发器 → 选择会话策略 → 查看运行日志 |
| 创建项目首页或交互卡片 | 加载 `spherse-write-html` 和 `spherse-use-ui-sdk` |
| 创建论坛、看板、游戏等数据应用 | 加载 `spherse-build-data-app`，设计 manifest 后同源生成数据、页面和 Agent |
| 定制项目或聊天外观 | 加载对应主题 Skill，写入项目或 Agent 的 `theme.css` |
| 在手机上继续聊天 | 桌面端启用移动访问 → 扫码连接 → 保持桌面应用运行 |

## 常见问题

### 为什么 Agent 不能使用某个工具？

检查 Agent profile 是否显式启用了该工具。工具存在于 Spherse 不代表每个 Agent 自动拥有它；文件工具还受项目 AI 访问限制约束。

### 为什么消息无法发送？

优先检查：

1. 是否已配置可用文本模型和 API Key
2. 目标会话是否仍在运行，忙碌会话不接收第二个 turn
3. Provider 或网络是否可用

### 为什么 Agent 没看到刚修改的配置？

Agent 配置会在下一次发送或重试前热重载，不会打断当前正在生成的回复。配置解析失败时会继续使用旧配置。

### 为什么手机无法连接？

确认桌面应用仍在运行、移动访问处于启用状态，并使用设置页当前显示的 URL 和 token。Quick Tunnel 重启后地址可能变化。

### 为什么 HTML 中不能获得当前会话？

只有聊天 HtmlCard 有 runtime context。欢迎页和 Content Browser 中的 HTML 没有当前 `sessionId` 或 `agentId`。

### 为什么数据文件发生覆盖？

不要把增长型数组整体通过 `data.set` 写回。页面和 Agent 应共享 `$manifest` mutation，分别使用 `spherse.data.mutate` 和 `mutate_data`。

### Spherse 会把项目上传到云端吗？

项目和运行时元数据以本地文件为主。与模型 Provider、MCP Server、外部链接或移动端 tunnel 交互时，相关数据会发送到用户配置的外部服务；应根据服务条款和数据敏感性选择配置。
