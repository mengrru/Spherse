# 项目目录索引

```
spherse/
├── packages/
│   ├── core/                         # @spherse/core — 纯 Node.js 核心逻辑（微内核 + Capability 架构）
│   │   └── src/
│   │       ├── types.ts              # 共享类型与 provider catalog / settings 类型定义
│   │       ├── logger.ts             # pino Logger 类型与 createSilentLogger 内部兜底工厂
│   │       ├── factory.ts            # assembleProject() 唯一装配点（defaultCapabilities 列表、Capability.init 接线；createProject 兼容导出）——新增能力 = 此处一行
│   │       ├── presets.ts            # initPresets()：新项目预置 agent 注入（core 内唯一 presets import）
│   │       ├── project-manager.ts    # ProjectManager：数据访问门面（server 不得见 store 实例）+ 写入门面（writeFile/writeBinaryFile/createEntry/deletePath/copyFileWithin = resolve+policy+per-path mutex）
│   │       ├── project-runtime.ts    # ProjectRuntime：轻量协调层（capability 生命周期遍历：onAgentDeleted/invalidateAgent/shutdown；triggerManager/timerService 为 derived getter）
│   │       ├── kernel/               # 内核：零 I/O 纯组合子（capabilities 与 session 的公共契约层）
│   │       │   ├── capability.ts     # Capability 接口（tools/contextBlocks/turnHooks/attachmentProcessors/pathRules/eventMiddlewares/init/onAgentDeleted/invalidateAgent/shutdown）+ TurnMiddlewareSource + CapabilityRegistry
│   │       │   ├── ports.ts          # SessionPort / ToolHost / SessionView（窄视图）/ StoreRegistry（含 forAgent 作用域）/ KernelServices（PathRule 定义在 access/path-category.ts，kernel 仅 type 引用）
│   │       │   ├── gates.ts          # ApprovalGate / AskGate 端口（session control 请求的类型源）
│   │       │   ├── event-pipeline.ts # EventMiddleware + createEventPipeline（横切组合律）
│   │       │   ├── turn-hooks.ts     # TurnHooks（beforeTurn/afterTurn/onReload）+ composeTurnHooks
│   │       │   └── context-block.ts  # 开放 ContextBlock { kind, render() } + serializeBlocks
│   │       ├── capabilities/         # 能力模块（只依赖 kernel 类型；每个目录自足）
│   │       │   ├── fs/               # read/write/edit/list/search/move/copy_file + generate_image
│   │       │   ├── skill/            # load_skill 工具 + skill-catalog context block（三层 skill 合并）
│   │       │   ├── changelog/        # append_changelog 工具
│   │       │   ├── render/           # render_card 工具（render capability）
│   │       │   ├── agent-mgmt/       # manage_agent 工具（工具名校验用运行时 toolCatalog）
│   │       │   ├── interaction/      # run_command / ask_user 工具（经 kernel gates）
│   │       │   ├── project-config/   # manage_project_config 工具（项目级配置：欢迎页设置）
│   │       │   ├── trigger/          # TriggerManager + TimerService（只见 SessionPort，循环依赖消解）
│   │       │   ├── mcp/              # McpConnectionManager + turnHooks（按配置版本 memo 的工具合并）+ mcp-context block
│   │       │   ├── attachments/      # image processor 贡献 + contextProjector（convertToLlm 前剥 _attachments/空 image block）
│   │       │   ├── compaction/       # maybeCompactLog 纯变换（transform.ts）+ capability
│   │       │   ├── time-perception/ # streamDecorators 贡献（<time> 前缀注入）+ previewTransforms（debug snapshot 重放）+ 提示 block；感知时间数学在 time-perception.ts
│   │       │   ├── memory/           # memory capability（memory_save/recall 工具接线 + <memory> block；MemoryStore 在 store/memory.ts）
│   │       │   ├── shared/           # llmPolicyOf 等跨能力共享工具
│   │       │   └── builtin.ts        # builtinToolCapabilities()：纯工具类 capability 集合
│   │       ├── session/              # 会话运行时（kernel 抽象的编排实例化）
│   │       │   ├── agent-runner.ts   # AgentRunner：turn 编排（sendMessage/retry/abort；in-flight guard；对具体能力零 import）
│   │       │   ├── agent-assembly.ts # 从 profile 构造 Agent（capability tools 聚合 + 身份 blocks + capability contextBlocks 组装 systemPrompt）
│   │       │   ├── session-manager.ts # SessionManager：纯 session 池（直接持 AgentRunner；hot-reload 标记；RunConfig 派发）
│   │       │   ├── runtime.ts        # RuntimeDeps（冻结）+ createRuntimeDeps 装配函数 + RunConfigHolder
│   │       │   ├── control-bus.ts    # SessionControlBus（requestId + kind 判别；swapEventSink 栈恢复）
│   │       │   ├── approval-gate.ts / ask-gate.ts # bus 薄适配器
│   │       │   ├── model-resolver.ts # resolveFor / resolveOrThrow（catalog 注入）
│   │       │   ├── events.ts / event-log.ts # SessionEvent 词汇表 + append-only SessionEventLog 门面
│   │       │   ├── fold.ts           # events → AgentMessage 投影 + open-turn repair
│   │       │   ├── legacy-migrate.ts # messages/compactions → events 按会话幂等迁移
│   │       │   ├── read-context-files.ts # profile 声明 context 文件读取（注入 systemPrompt 的 preloaded block；access policy 过滤）
│   │       │   ├── event-middlewares.ts # log/persist（session 层不变量）
│   │       │   ├── log-agent-event.ts # agent event → pino 日志映射
│   │       │   └── status.ts / types.ts
│   │       ├── store/                # 存储层抽象（不持有运行时状态；磁盘真相）
│   │       │   ├── project.ts        # ProjectStore 聚合根（EventEmitter；agents Map；AGENTS.md/CHANGELOG.md）
│   │       │   ├── agent-store.ts    # per-agent 聚合（profile/sessions/triggers/skills/mcp lazy getter）
│   │       │   ├── session.ts        # SQLite session 持久化（events 主写；messages/compactions legacy 只读）
│   │       │   ├── trigger.ts / skill.ts / mcp-config.ts / memory.ts / agent-profile.ts / agent-slug.ts / project-config.ts
│   │       ├── tools/                # AgentTool 实现体（capability 的实现层，无注册表）
│   │       │   ├── read/write/edit/list/search/move/copy-file.ts、run-command.ts、ask-user.ts、manage-agent.ts、manage-trigger.ts、manage-project-config.ts、emit-trigger-event.ts、load-skill.ts、render-card.ts、generate-image.ts、append-changelog.ts、memory-save.ts、memory-recall.ts、with-approval.ts、json-check.ts
│   │       ├── trigger/              # TriggerManager（门面：CRUD+事件+委派）/ scheduler（时间调度状态）/ executor（fire 执行+日志）/ TimerService / template / validation
│   │       ├── access/               # path-category（内置 PATH_PATTERNS + PathRule 类型 + 注册规则优先）/ access-policy（llm/server 工厂，裁决优先级 deniedPaths > pathRules > 白名单）/ denied-paths
│   │       ├── context/              # context window 管理域（跨层共享纯函数）：compaction（planCompaction/sanitizeToolCallPairs）/ token-estimate
│   │       ├── attachments/          # 附件域：AttachmentProcessor 端口 + image-processor + sanitizer（base64 卫生不变量）+ strip/sanitize
│   │       ├── mcp/                  # mcp-client（连接与工具适配）/ mcp-connection-manager / config / types / json-schema-to-typebox
│   │       ├── model-providers/      # ModelCatalog 类（per-runtime 实例，所有权在组合根）+ zhipu/openai images + index（仅 images 静态目录导出）
│   │       ├── utils/                # file-write-mutex（全链路唯一实例）/ fs-walk / path-safety / binary-detect / xml-escape
│   │       ├── __tests__/            # Vitest 单元测试（kernel/capabilities/session/access/tools 分组）
│   │       └── index.ts              # 公开导出（显式清单，按外部消费面收紧）
│   ├── presets/                      # @spherse/presets — 内置模板与预置静态内容
│   │   ├── README.md                 # 包级守则：sync 产物、presets.json 格式、注入流程与维护守则
│   │   ├── presets.json              # 预置 skill、agent 与 prompt template 声明配置
│   │   ├── templates/
│   │   │   ├── agent-template.md     # 新 Agent 创建模板源文件
│   │   │   ├── agent-theme-template.css # Agent 聊天窗口主题模板源文件
│   │   │   ├── agents-index-template.md # 新项目 AGENTS.md 模板源文件
│   │   │   ├── preset-agents/        # 预置 agent 模板源文件（<dir>.md 完整 profile，由 presets.json 的 presetAgents 声明）
│   │   │   └── prompt-templates/     # 预置 prompt template 源文件（<id>.md，由 presets.json 的 presetPromptTemplates 声明）
│   │   ├── sample-projects/          # 内置示例项目源（新用户引导页「打开示例项目」拷贝到用户选定位置；manifest.json + 各示例完整项目树）
│   │   │   ├── manifest.json         # 示例清单（[{ id, displayName, dirName }]）
│   │   │   └── harry-potter/         # Harry Potter 示例项目（完整项目树，含 .spherse/project.yaml、agents、文档）
│   │   ├── skills/                   # 内置 skill 源（app 内置只读，通过 SkillStore 内存合并；新项目不再注入到 .spherse/skills/）
│   │   │   ├── spherse-guide/        # Spherse 功能介绍、快速上手、目标导向使用引导与常见问题
│   │   │   │   └── SKILL.md
│   │   │   ├── spherse-create-ui-theme/ # 自定义 UI 主题创建指南
│   │   │   │   └── SKILL.md
│   │   │   ├── spherse-create-agent-chat-theme/ # Agent 聊天窗口主题创建指南
│   │   │   │   └── SKILL.md
│   │   │   ├── spherse-use-ui-sdk/    # window.spherse 注入 SDK 使用指南（action、data CRUD、api 只读 bridge、文件变化事件、运行时上下文）
│   │   │   │   └── SKILL.md
│   │   │   ├── spherse-build-data-app/ # HTML 页面与 Agent 协作的数据型应用建模指南（manifest query/mutation、上下文与写入准确性）
│   │   │   │   └── SKILL.md
│   │   │   ├── spherse-write-html/    # HTML 页面数据读写与 App 能力调用指南（charset、数据外置、window.spherse 调用）
│   │   │   │   └── SKILL.md
│   │   │   └── spherse-create-skill/ # 自定义 skill 创建指南（两层 skill 体系与 SKILL.md 格式）
│   │   │       └── SKILL.md
│   │   ├── scripts/
│   │   │   └── sync-templates.mjs    # 模板与预置内容同步脚本（.md → .ts 常量 + presets.json → 预置常量 + skills/ → skill 源码常量）
│   │   ├── __tests__/
│   │   │   └── sync-templates.test.ts # sync-templates 输出验证测试
│   │   └── src/
│   │       ├── generated/            # 构建时由 sync-templates.mjs 自动生成（不入版本库）
│   │       │   ├── agent-template.ts
│   │       │   ├── agent-theme-template.ts
│   │       │   ├── presets.ts        # PRESET_SKILLS, PRESET_AGENTS 常量
│   │       │   ├── preset-skills.ts  # PRESET_SKILL_SOURCES 常量
│   │       │   └── prompt-templates.ts # PRESET_PROMPT_TEMPLATES 常量（{ id, name, prompt }）
│   │       └── index.ts              # 公开导出：模板内容 + 预置 skill/agent/prompt template 配置
│   ├── i18n/                         # @spherse/i18n — 纯 TS i18n 基础设施
│   │   ├── README.md                 # 包级守则：翻译基准、逐条注释规范、校验命令
│   │   ├── scripts/
│   │   │   └── check-i18n.mjs        # locale key 一致性校验脚本
│   │   └── src/
│   │       ├── types.ts              # Locale, SUPPORTED_LOCALES, DEFAULT_LOCALE
│   │       ├── catalog.ts            # 聚合 locale 文件，导出 TranslationKey
│   │       ├── translate.ts          # normalizeLocale, translate, createTranslator
│   │       ├── format.ts             # {var} 插值
│   │       ├── react.tsx             # I18nProvider, useI18n（React 子入口）
│   │       ├── locales/
│   │       │   ├── zh-CN.ts          # 简体中文（canonical catalog）
│   │       │   ├── zh-TW.ts          # 繁體中文
│   │       │   └── en.ts             # English
│   │       ├── __tests__/            # Vitest 单元测试
│   │       └── index.ts              # 主入口：纯函数 API
│   ├── sdk/                          # @spherse/sdk — 注入到 iframe HTML 的 UI SDK 运行时
│   │   ├── scripts/
│   │   │   ├── build.mjs             # esbuild 将 src/runtime 打包为单文件 IIFE（dist/browser.js），并据此生成 SDK_SOURCE 字符串（dist/source.js）
│   │   │   └── dev.mjs               # watch：runtime 变动重建 browser.js/source.js + tsc --watch
│   │   └── src/
│   │       ├── meta.ts               # SDK_VERSION / SDK_MARK（data-spherse-sdk）/ SDK_FILENAME（__spherse-sdk.js）
│   │       ├── inject-head-script.ts # injectHeadScript() — 幂等 HTML <head> 注入（renderer 与 server 共享）
│   │       ├── index.ts              # node-facing 公开导出（meta 常量 + injectHeadScript，零依赖，browser-safe）
│   │       ├── runtime/              # 浏览器运行时（可读 TS，由 esbuild 打包为 IIFE）
│   │       │   ├── index.ts          # 入口：幂等守护（window.__SPHERSE_SDK__）+ 组装 window.spherse（call/fire/getRuntime + actions/data/api/events）
│   │       │   ├── messaging.ts      # call/fire + spherse:response 监听（requestId 匹配，10s 超时）
│   │       │   ├── context.ts        # 运行时上下文种子化（window.__SPHERSE__ 同步 / spherse:runtime 异步）
│   │       │   ├── actions.ts        # 触发型便捷方法（openFile/createSession/float* 等）
│   │       │   ├── data.ts           # data.get/set/delete 键值存储
│   │       │   ├── api.ts            # api.* 只读 HTTP bridge（api.call + agents/sessions/content/... 子命名空间）
│   │       │   └── events.ts         # events.on 订阅 API + spherse:event 消息分发与 pagehide 清理
│   │       └── __tests__/
│   │           ├── inject-head-script.test.ts # injectHeadScript + 打包产物（SDK_SOURCE）断言
│   │           ├── messaging.test.ts          # postAction/fire/call（resolve/reject/超时/并发 requestId 匹配）
│   │           ├── context.test.ts            # 运行时种子化（window.__SPHERSE__ 同步 + spherse:runtime 异步 + waiter 队列）
│   │           └── events.test.ts             # 文件事件订阅、定向分发与幂等取消
│   ├── server/                       # @spherse/server — Fastify API 层
│   │   └── src/
    │   │       ├── index.ts              # createMultiProjectServer()，创建 logger、Fastify 实例并注册 ProjectRegistry
    │   │       ├── logger.ts             # createServerLogger()：pino multistream（pretty + debug WS），composition root
    │   │       ├── registry.ts           # ProjectRegistry：Map<projectId, ProjectContext>，项目 register/remove
    │   │       ├── marketplace.ts        # 技能市场 service：OSS manifest 代理（30s 内存缓存，env SPHERSE_MARKETPLACE_MANIFEST_URL 可覆盖 URL）+ zip 下载（同源 SSRF 校验、50MB 上限）
    │   │       ├── contracts/            # HTTP/WebSocket runtime schema 与解析 helper（@spherse/server/contracts）
    │   │       │   ├── index.ts          # 聚合 schemas 与类型 re-export，对外稳定入口
    │   │       │   ├── common.ts         # okResponse/errorResponse、parseContract/parseApiResponse
    │   │       │   ├── agents.ts         # AgentProfile、AgentCreate/Update、MCP（mcpServerConfig/AgentMcpResponse/AgentMcpUpdateRequest）Request/Response
    │   │       │   ├── sessions.ts       # SessionInfo、SessionList/Messages Response、SessionMessagesPage（分页信封）、rename 请求
    │   │       │   ├── content.ts        # FileEntry、ContentResponse、create/save 请求
    │   │       │   ├── file-tree.ts      # FileTreeResponse
    │   │       │   ├── settings.ts       # ProviderCatalog、AiAccess/WelcomePage/Theme Request/Response
    │   │       │   ├── trigger.ts        # TriggerEntry、TriggerCreate/Update 请求、List/Log Response
    │   │       │   ├── skills.ts         # SkillDefinition（含可选 version）、SkillList/Create/Install Request 响应与请求 schema
    │   │       │   ├── marketplace.ts    # MarketplaceSkillEntry、MarketplaceManifestResponse、SkillMarketplaceInstallRequest（{name, version}）
    │   │       │   ├── debug.ts          # TurnContextSnapshot
    │   │       │   └── websocket.ts      # ChatClientMessage/ChatServerEvent/TriggerServerEvent + parser
│   │       ├── routes/               # REST 路由，按业务域拆分
│   │       │   ├── index.ts          # registerAllRoutes 聚合
│   │       │   ├── agents.ts         # Agent 查询与 raw 内容读取
    │   │       │   ├── agent-write.ts    # Agent 创建/更新/删除
    │   │       │   ├── agent-mcp.ts      # Agent MCP 连接器配置读写（GET/PUT /api/projects/:projectId/agents/:id/mcp）
│       │       │   ├── sessions.ts       # Session 创建/查询/重命名/删除与消息读取
│   │       │   ├── content.ts        # 内容浏览、读取、保存、删除、新建文件/目录
│   │       │   ├── file-tree.ts      # 面向 agent context 选择的项目文件列表
│   │       │   ├── preview.ts        # HTML 文件预览服务
│   │       │   ├── skills.ts         # Skill 列表、详情与创建/安装路由
    │   │       │   ├── marketplace.ts    # 技能市场路由（GET /marketplace/skills 代理 manifest；POST /skills/marketplace-install 按 {name, version} 下载 zip 并覆盖安装）
│   │       │   ├── settings.ts       # 文本/图片 Provider 列表（GET /api/settings/providers、/image-providers）+ 项目 settings API（AI 读取禁止列表、欢迎页、主题 CSS）
│   │       │   ├── images.ts         # 图片导出 API（POST /api/projects/:projectId/images/export，将生成的图片复制到项目目标路径）
│   │       │   ├── attachments.ts    # 通用附件上传/删除 API（POST/DELETE /api/projects/:projectId/attachments，图片落盘 .spherse/attachments/）
│       │       │   ├── trigger.ts         # 触发器 CRUD 与手动触发（/triggers、/trigger-logs、/run）
│       │       │   └── debug.ts         # Debug turn context 导出（dev only）
│       │       ├── ws-chat.ts            # WebSocket 对话流（/ws/projects/:projectId/chat/...，双向 session-scoped）
│       │       ├── ws-bus.ts             # 全局多路复用 bus WebSocket（/ws/bus，trigger/fs-watch/debug 按 projectId×channel 订阅）
│       │       └── lib/
│       │           └── fs-watcher.ts     # 按项目引用计数的共享 fs.watch（多订阅者共享 1 个 OS watcher）；过滤决策基于 core categorizePath 的 watched-category 集合 + node_modules/.git 段级降噪
│   ├── app/                          # @spherse/app — 共享 React renderer（前端源码，被 desktop/web 消费）
│   │   ├── README.md                 # renderer 架构、状态边界、编码规范与验证清单
│   │   ├── index.html                # renderer 入口 HTML（vite 入口）
│   │   ├── vitest.config.ts          # Vitest 单元测试配置（排除 e2e 目录）
│   │   ├── components.json           # shadcn/ui 配置（Base UI base + Tailwind v4 + alias）
│   │   └── src/
│   │       ├── App.tsx               # App shell：Activity Bar、设置弹窗、全局初始化
│   │       ├── main.tsx              # renderer 入口，挂载 QueryClientProvider 与 RouterProvider
│   │       ├── router.tsx            # React Router Hash Router 路由表
│   │       ├── styles.css            # Tailwind CSS v4 + shadcn 语义 token（单一 token 体系）
│   │       ├── lib/
│   │       │   ├── api.ts            # HTTP/WS 客户端封装
│   │       │   ├── semver.ts         # semver 解析与比较（parseSemver/isValidSemver/compareSemver，市场技能版本比较用）
│   │       │   ├── agent-markdown.ts # Agent 定义 Markdown 生成/解析辅助
│   │       │   ├── project-key.ts    # project path → URL projectKey 生成
│   │       │   ├── tool-registry.ts  # 前端权限分组元数据（TOOL_GROUPS：读取文件/写入文件/独立工具）
│   │       │   ├── types.ts          # 前端类型
│   │       │   ├── electron-api.ts   # 全局 Window.electronAPI 类型声明（类型来自 @shared/electron-api）
│   │       │   ├── use-project-navigation.ts # 项目级导航 hook（back 不跨项目边界，模块级 per-project 历史栈）
│   │       │   ├── use-connection.ts  # useApiClient(projectId) / useConnection() — 基于 app-store connection 派生 ApiClient
│   │       │   ├── utils.ts          # shadcn/ui cn() 工具
│   │       │   └── localstorage/
│   │       │       └── last-route.ts # per-project lastRoute localStorage helper（spherse:last-route:<projectId>）
│   │       ├── context/
│   │       │   └── project-context.tsx # ProjectProvider / useProjectCtx — project scope 的 ctx 注入（projectId/projectRoot）
│   │       ├── queries/                 # TanStack Query 基础设施：client、key factory、project/content/skills/welcome-page/theme-settings/triggers 服务端状态
│   │       ├── stores/
│   │       │   ├── app-store.ts          # 打开项目集合、当前项目（含 lastOpened 排序）、Electron IPC 动作
│   │       │   ├── project-data-store.ts # 初始消息/streaming session id 等前端运行时投影
│   │       │   ├── app-ui-store.ts       # 应用级临时 UI 状态（settings 弹窗 open 状态等）
│   │       │   ├── settings-store.ts     # 应用级 locale/theme/debugTools 等持久化设置（与设置文件同步）
│   │       │   ├── side-panel-store.ts   # side panel pinned/hover 折叠机制（全局 UI 状态，localStorage 持久化）+ 移动端 mobileOpen 滑出态（与桌面解耦）
│   │       │   └── bus-store.ts          # 全局多路复用 WebSocket 连接 store
│   │       ├── layouts/
│   │       │   ├── ProjectScope.tsx      # 项目工作区 layout route（真嵌套路由），挂 ProjectProvider + Outlet 与项目级 hook
│   │       │   ├── ProjectRuntimeBridges.tsx # 项目级桥纯挂载 fragment（FeatureGate manager + 各自治 bridge）
│   │       │   └── project-lifecycle.ts  # closeProjectCascade：项目关闭级联清理单一入口（structure test 强制清理面完整）
│   │       ├── hooks/
│   │       │   ├── useSidePanel.ts       # side panel pinned/hover/mobileOpen 状态合并派生 + clickAway props
│   │       │   ├── useCustomTheme.ts
│   │       │   ├── useDismissable.ts
│   │       │   ├── use-mobile.ts
│   │       │   ├── use-coarse-pointer.ts # (pointer: coarse) 探测触摸主输入（软键盘场景，chat Composer 回车换行）
│   │       │   ├── useAgentBusRefresh.ts # bus agent_updated 事件刷新 agent 列表
│   │       │   ├── useBusSubscription.ts # bus 事件订阅 hook
│   │       │   └── useReconnectedSync.ts # bus 重连回调（resync 补偿）
│   │       ├── ui-sdk/
│   │       │   ├── UiSdkBridge.tsx       # 自治集成组件：从 ProjectContext 派生 client，统一挂载 action/event bridge
│   │       │   ├── types.ts              # ActionContext, ActionHandler 类型
│   │       │   ├── registry.ts           # registerAction / dispatchAction
│   │       │   ├── rate-limit.ts         # 外部调用频率限制（含白名单豁免）
│   │       │   ├── respond.ts            # request-response 回复工具（requestId → spherse:response postMessage）
│   │       │   ├── use-spherse-message-listener.ts # postMessage → dispatchAction 桥梁
│   │       │   ├── event/
│   │       │   │   ├── use-event-bridge.ts      # event control listener + fs-watch 路由
│   │       │   │   ├── subscription-registry.ts # iframe 订阅、过滤与定向投递
│   │       │   │   ├── types.ts                 # subscribe/unsubscribe/push 协议类型
│   │       │   │   └── file-update.ts           # 文件路径规范化、payload 校验与 300ms 去抖
│   │       │   ├── index.ts              # barrel export + handler side-effect import
│   │       │   └── handlers/
│   │       │       ├── create-session.ts # 创建会话并导航，支持 float 参数直达浮窗（web 端降级为跳转 chat page）
│   │       │       ├── float-content.ts  # 将指定文件以浮窗打开（web 端降级为跳转 content page）
│   │       │       ├── float-session.ts  # 将指定会话移入浮窗（web 端降级为跳转 chat page）
│   │       │       ├── open-chat.ts      # openChat 工具：按 hostKind 决定 setFloatingChat 或 navigate 到 chat page
│   │       │       ├── open-file.ts      # 在 Content Browser 打开文件
│   │       │       ├── send-message.ts   # 向已有会话发送消息并导航，支持 float 参数与 request-response（session_busy 反馈）；已浮窗会话不导航；web 端 float 降级为跳转
│   │       │       ├── unfloat-content.ts # 关闭指定文件的浮窗
│   │       │       ├── unfloat-session.ts # 取消浮窗
│   │       │       ├── data.ts           # data.get/set/delete key-value 持久化
│   │       │       └── api.ts            # api.call 只读 HTTP bridge（op 白名单转发 ApiClient，agents/sessions/content/fileTree）
│   │       ├── features/
│   │       │   ├── activity-bar/         # 自治型 Activity Bar（项目头像轨、设置/添加按钮），内部读 app-store/app-ui-store 与 useProjectActions；pin 按钮通过 pinToggle prop 可选注入
│   │       │   ├── agent-trigger/        # Agent 触发器弹窗、表单、列表与运行日志，含 running 运行态 feature store 与 TriggerEventBridge（trigger 域唯一事件接线：查询失效 + 运行态 + 通知）
│   │       │   ├── agent-session-list/   # Agent/session 分组列表，含 AgentDialog/SearchFileField 与折叠状态 feature store
│   │       │   ├── chat/                 # 对话 feature；model/ 放事件解析、历史投影与 reducer，runtime/ 放 streaming store、WS/心跳/重连 runtime，hooks/ 放 UI hooks，lib/ 放聚合/diff/format-time 纯函数，utils/ 放图片压缩（compress-image）；根目录保留页面组件、运行时 context、chat 专属类型与附件 UI（AttachmentBar/MessageAttachments）
│   │       │   ├── content-browser/      # 文件浏览、预览（HTML/markdown/image）、编辑、复制路径/刷新、冲突提示，ContentQueryBridge 集中处理 fs-watch/reconnect 缓存失效；二进制文件拦截渲染占位卡 UnsupportedFileCard（桌面端经 HostCapabilities.openFileExternal 提供「用默认应用打开」按钮）
│   │       │   ├── debug-tools/          # 调试菜单（开发模式或设置开启 debugToolsEnabled 时显示）+ Streaming Log 悬浮面板
│   │       │   ├── floating-chat/         # 浮动聊天窗口（Portal overlay、主题隔离），复用 components/floating-frame；含 useFloatingSessionId
│   │       │   ├── floating-content-browser/ # 浮窗内容浏览器（多窗口、复用 ContentView 只读渲染 + components/floating-frame），含 useFloatedFilePaths；从文件树右键「浮窗」触发
│   │       │   ├── onboarding/           # 新用户引导页（无项目时 `/` 路由）：打开或创建项目 / 打开示例项目
│   │       │   ├── project-panel/         # 项目侧栏内容（AgentSessionList/UserFilePanel/SkillPanel 薄组合层），作为 SidePanel 的静态 flex child
│   │       │   ├── side-panel/           # 项目工作区左侧滑动单元：桌面端物理合并 ActivityBar + ProjectPanel 为同一 transform 容器（pinned/hover 滑入滑出）；移动端（useIsMobile 768px 断点）改为左下角浮动按钮 + 常驻 CSS 滑动面板（translate-x + backdrop，关闭态 inert），由解耦的 mobileOpen 状态控制
│   │       │   ├── user-file-panel/      # Files section（SidebarGroup + AI 读取限制 dialog），复用 base components/file-tree
│   │       │   ├── skill-panel/          # Skills section（三点菜单：技能市场/创建/安装技能 + CreateSkillDialog + MarketplaceDialog + marketplace-state 卡片状态推导），复用 base components/file-tree（rootPath=".spherse/skills"）
│   │       │   ├── settings/             # 设置弹窗（文本/图片/通用/关于 tab，文本 tab 含默认模型 + 思考强度选择 ThinkingLevelField、高级采样参数，支持自定义 OpenAI 兼容供应商：CustomProviderDialog 创建/编辑、ModelProviderItem 行渲染、custom-provider-id id 生成）、更新检查 hook（useUpdateChecker reducer + 挂载恢复归位）与 UpdateChecker 组件、UpdateNoticeBridge（自动检测发现新版 → 全局右下角 toast，App 根挂载）、设置 store、类型与测试
│   │       │   ├── welcome-page/         # 项目欢迎页渲染（HTML iframe / 图片）+ WelcomePageQueryBridge（project.yaml fs-watch/reconnect → welcome-page 查询失效，ProjectRuntimeBridges 挂载）
│   │       │   ├── project-settings/     # 项目设置弹窗集合
│   │       │   │   ├── welcome-page-settings/ # 项目欢迎页路径设置弹窗
│   │       │   │   └── theme-settings/        # 项目主题 CSS 编辑弹窗 + ThemeQueryBridge（fs-watch/reconnect → theme-settings 查询失效，ProjectRuntimeBridges 挂载）
│   │       │   └── text-selection-session/ # 划选文本后发起会话
│   │       ├── pages/
│   │       │   ├── ChatPage.tsx          # Chat 路由 page，从 URL :sessionId 解析 session/agent 后渲染 Chat
│   │       │   ├── ContentBrowserPage.tsx # Content 路由 page，从 ?path= 查询参数渲染 ContentBrowser
│   │       │   ├── OnboardingPage.tsx    # App index 路由 page，re-export onboarding 引导页（无项目时显示）
│   │       │   └── WelcomePagePage.tsx   # Project index 路由 page，渲染 WelcomePage 空状态
│   │       └── components/
│   │           ├── ui/                   # shadcn/ui 本地基础组件（Base UI 底层原语）与 TreeRow 等通用 UI 样式组件
│   │           ├── file-tree/            # 可复用文件树基础组件（FileTree + 树模型 + controller hook + 通用 dialog），支持可选 rootPath/emptyLabel/onFloatFile/floatedFilePaths，被 user-file-panel 与 skill-panel 共用
│   │           ├── floating-frame/       # 通用浮动窗口 chrome（拖拽/调整大小、titlebar、close），由 floating-chat 与 floating-content-browser 复用；hookPrefix 参数生成各自 data-*-float-* 主题钩子
│   │           └── markdown-content/     # Markdown 渲染域：MarkdownContent（统一渲染组件，plain 模式用于用户消息）、CodeBlock、markdown-code-text（代码块文本抽取）、remark-plain-structure（plain 模式 remark 插件：list/table/thematicBreak 还原为带字面标记的文本行，保序号/行结构）
│   ├── desktop/                      # @spherse/desktop — Electron 桌面壳（main/preload/electron 基础设施）
│   │   ├── electron.vite.config.ts   # electron-vite 配置（main + preload + renderer，renderer root 指向 ../app）
│   │   ├── electron-builder.yml      # electron-builder 打包配置（appId、DMG、NSIS、extraResources、publish GitHub Releases）
│   │   ├── playwright.config.ts      # Playwright E2E 测试配置
│   │   ├── vitest.config.ts          # Vitest 单元测试配置（排除 e2e 目录）
│   │   ├── shared/
│   │   │   └── electron-api.ts       # Electron IPC 类型契约（renderer 与 main 共享，renderer 经 tsconfig @shared 别名引用）
 │   │   ├── electron/
│   │   │   ├── bootstrap.ts          # Electron 入口引导：dev 环境重定向 userData 后加载 main
│   │   │   ├── main.ts               # Electron 主进程：启动时 fixPath（打包版 PATH 修复）→ restoreEnvFromSettings → 组装窗口、IPC、项目 server 管理、启动延迟静默更新检查
│   │   │   ├── fix-path.ts           # 打包版 PATH 修复：仅 packaged + darwin/linux，spawn 用户登录 shell（$SHELL -lic 'echo $PATH'，TERM=dumb，3s 超时）拉取登录 shell 的 PATH，剥离 ANSI/控制字节后按去重保序前置合并进 process.env.PATH（dev/test/win32 no-op，失败保留原 PATH 不阻断启动）；修复 GUI 进程不继承 shell PATH 导致 stdio MCP server（uvx/npx/python）找不到可执行文件
│   │   │   ├── preload.ts            # contextBridge，IPC 白名单（含更新检查 main→renderer 事件订阅）
│   │   │   ├── updater.ts            # 更新检测：OSS latest.json 清单 + compareVersions + 平台 downloadUrl 解析（electron-updater 仅保留 Windows in-app 下载 API，feed 已废弃）、silent 检测不改写交互状态、startAutoUpdateChecks 调度（启动 5s + 每小时 tick，≥24h 且用户活动时静默检测）
│   │   │   ├── sample-projects.ts    # 内置示例项目资源路径解析（dev/packaged）+ manifest 读取（供 onboarding「打开示例项目」）
│   │   │   ├── unsafe-location.ts    # 项目路径「易失区」判定：getUnsafeZoneRoot 计算更新时会被覆盖清空的目录（win32 = dirname(process.execPath)，NSIS 卸载器 RMDir /r $INSTDIR 作用域；darwin = .app bundle 目录；dev/linux 无，dev 下 SPHERSE_UNSAFE_ZONE env 可覆盖供 E2E 指定），isInsideUnsafeZone 经 @spherse/core 的 isPathInside 判断（打开/示例项目 IPC 弹警告框用）
│   │   │   ├── ipc/                  # IPC handler 注册，按业务域拆分
│   │   │   │   ├── index.ts          # registerAllIpc 聚合
│   │   │   │   ├── project.ts        # 项目选择、server 启停、打开项目持久化、打开示例项目、打开项目文件夹（shell.openPath）、用默认应用打开文件（openFileExternal）；confirmUnsafeLocation 对安装目录内路径弹警告框（默认取消），restore-projects 恢复后对存量易失区项目每会话弹一次迁移警告
│   │   │   │   ├── open-file-path.ts # isInsideAnyOpenProject 路径校验辅助（openFileExternal handler 使用，校验路径在已打开项目内）
│   │   │   │   ├── settings.ts       # 设置读取/保存与 provider 列表
│   │   │   │   ├── updater.ts        # 更新检查 IPC（check/download/install/cancel/get-state/get-app-version/open-external）
│   │   │   │   ├── skill.ts          # 技能 zip 安装原生文件选择器（select-skill-zip）
│   │   │   │   ├── context-menu.ts   # 文本框原生右键菜单：webContents 'context-menu' 事件（isEditable 门控，editFlags 控制 enable，i18n 本地化 undo/redo/cut/copy/paste/selectAll）
│   │   │   │   ├── debug.ts          # 开发模式 debug 动作
│   │   │   │   └── mobile.ts         # 移动端访问 IPC（get/enable/disable/regenerate-token/restart-tunnel/set-mode/set-public-domain）+ tunnel 状态推送；quick 模式自动启动 cloudflared，manual 模式仅暴露端口 + 用户自填域名
│   │   │   ├── tunnel/                # Cloudflare Quick Tunnel 集成（移动端远程访问中继，仅 quick 模式使用）
│   │   │   │   ├── provider.ts        # TunnelProvider / TunnelSession 抽象接口（预留未来扩展）
│   │   │   │   ├── cloudflare-provider.ts # Cloudflare Quick Tunnel 实现：spawn cloudflared tunnel --url、stdout 抓取 *.trycloudflare.com URL、packaged 二进制路径解析
│   │   │   │   └── manager.ts         # TunnelManager 单例：start/stop/restart 状态机 + onStateChange 事件订阅
│   │   │   ├── window.ts             # BrowserWindow 创建与管理
│   │   │   ├── server.ts             # 多 Fastify 实例管理（Map<projectPath, {server, engine}>）+ 运行时 defaultModel 更新 + restartServerWithAuth（启用/停用 mobile access 时带 token 重启）
│   │   │   └── settings.ts           # electron-store 封装 + env 管理（含自定义供应商 syncCustomProviders 注册）+ openProjects/locale 持久化 + mobileAccess（token/enabled/mode/publicDomain）持久化 + generateAccessToken
│   │   └── e2e/                      # Playwright E2E 测试
│   │       ├── helpers/
│   │       │   ├── electron.ts       # Electron 应用启动辅助（测试项目创建、app launch）
│   │       │   ├── file-tree.ts      # 文件树 E2E 测试辅助（项目创建、app launch）
│   │       │   └── chat.ts           # Chat E2E 测试辅助（mock agent 项目、WS mock、会话 API）
│   │       ├── agent-dialog.spec.ts  # Agent 对话框搜索文件 E2E 测试
│   │       ├── app-launch.spec.ts    # App 启动验证 smoke test
│   │       ├── chat-streaming-resilience.spec.ts # Chat streaming 切换 session/后台流式/E2E WebSocket mock
│   │       ├── project-close.spec.ts # 项目关闭 E2E 测试（streaming 中关闭断连 runtime、重启后干净重开）
│   │       ├── unsafe-location-guard.spec.ts # 易失区拦截 E2E 测试（SPHERSE_UNSAFE_ZONE + SPHERSE_E2E_DIALOG_RESPONSE seam：拒绝/确认 open-project、存量项目启动警告）
│   │       ├── file-tree.spec.ts     # 文件树 E2E 测试（展开折叠、创建删除、溢出截断）
│   │       ├── agent-list.spec.ts              # Agent 列表展开折叠与会话重命名 E2E 测试
│   │       ├── floating-chat.spec.ts            # 浮窗聊天 E2E 测试（浮窗/关闭/拖动/调整大小/项目切换）
│   │       ├── text-selection-session.spec.ts  # 划选会话 E2E 测试
│   │       ├── ui-sdk.spec.ts          # UI SDK postMessage action E2E 测试
│   │       ├── ui-sdk-data-crud.spec.ts # UI SDK data CRUD key-value 持久化 E2E 测试
│   │       └── ui-sdk-bridge.spec.ts   # 注入式 @spherse/sdk 桥接 E2E 测试（window.spherse.* 暴露面 / fire 导航 / call 往返 / api.* HTTP 桥接 resolve+reject）
│   ├── web/                          # @spherse/web — Web 版本壳 / 移动端 PWA（GitHub Pages 部署到 /web/）
│   │   ├── vite.config.ts            # Vite + vite-plugin-pwa（manifest + generateSW app shell precache）+ manualChunks（vendor-react/vendor-markdown）
│   │   ├── index.html                # 入口 HTML（theme-color / apple-mobile-web-app / viewport-fit=cover 元数据）
│   │   ├── public/                   # PWA 静态资源
│   │   │   ├── favicon.svg
│   │   │   └── icons/                # PWA 图标（pwa-192/512、maskable-512、apple-touch-icon，从 desktop/build 派生）
│   │   ├── pages-assets/404.html     # GitHub Pages SPA fallback（/web → /web/，其余 → /）
│   │   └── src/                      # Web 版本专属源码
│   │       ├── main.tsx              # 注入 WebHostBridge 调 createAppRoot
│   │       ├── host-bridge-web.tsx   # HostBridge 的 Web 实现（HTTP+localStorage 子集、token 探活、disconnect）
│   │       └── pages/MobileConnectPage.tsx # 扫码/手动输入连接页
│   ├── landing/                      # @spherse/landing — GitHub Pages 项目介绍页（自定义域名 spherse.mengru.work）
│   │   ├── vite.config.ts            # 标准 Vite 构建配置（base: "/"，自定义域名根路径部署）
│   │   ├── vitest.config.ts          # 单测配置（jsdom 环境，release.ts 下载链接解析逻辑）
│   │   ├── index.html                # 入口 HTML
│   │   ├── public/                   # 静态资源（截图、主题 CSS）
│   │   │   ├── CNAME                # GitHub Pages 自定义域名声明（内容 spherse.mengru.work）
│   │   │   ├── screenshots/          # 轮播截图 + feature 浮层截图
│   │   │   └── themes/              # 轮播切换时动态加载的主题 CSS（覆盖 --sp-* 变量）
│   │   └── src/
│   │       ├── styles.css            # Tailwind v4 + --sp-* token 体系（从 app 精简复制）
│   │       ├── lib/                  # release.ts（OSS latest.json 解析 + 平台/架构检测选安装包）及单测
│   │       ├── i18n/                 # landing 专属 i18n（复用 @spherse/i18n 类型与 locale 工具，自建 catalog）
│   │       │   ├── index.ts          # useLandingI18n hook + localStorage 持久化
│   │       │   └── locales/          # zh-CN / zh-TW / en 三语
│   │       ├── components/           # 页面组件（Hero、Carousel、FeatureCards、FeatureModal、LanguageSwitcher 等）
│   │       │   └── ui/              # 从 app 复制的 shadcn 组件（button、dialog）
│   │       └── data/                # 轮播与 feature 配置数据
├── scripts/
│   └── rebuild-native.mjs            # Electron native dependency rebuild
├── docs/
│   ├── official/                     # 正式项目文档（始终与代码同步；索引与写作规范见 README.md）
│   │   ├── README.md                 # 按任务路由的索引 + official 写作规范
│   │   ├── architecture/             # 架构文档（按域拆分）
│   │   │   ├── index.md              # 全局概览 + package 边界
│   │   │   ├── core.md               # 内核/会话运行时/store/PM 门面
│   │   │   ├── capabilities.md       # 能力模块与工具聚合
│   │   │   ├── security.md           # 访问策略/审批/run_command 安全模型
│   │   │   ├── server.md             # Fastify/contracts/WS/bus
│   │   │   ├── desktop.md            # Electron/设置/模型配置/更新
│   │   │   ├── frontend.md           # 路由/查询缓存/feature 组织
│   │   │   ├── chat.md               # 聊天流式/重试/历史/滚动
│   │   │   ├── ui-sdk.md             # UI SDK 与注入桥
│   │   │   ├── theming.md            # token 体系/三级主题/DOM 入口
│   │   │   └── i18n.md               # i18n 架构
│   │   ├── data-conventions.md       # 数据文件格式与存储约定
│   │   ├── glossary.md               # 术语表：一词一行 + 权威文档指针
│   │   └── project-structure.md      # 本文件：完整目录索引
│   └── dev/                          # 开发过程文档（容易过时）
│       ├── decisions/                # ADR 决策记录（编号、只追加；索引与规则见 README.md）
│       ├── features/                 # {yyyy-MM-dd-feature-name}/ 下放 spec + plan
│       ├── infra/                    # {yyyy-MM-dd-name}/ 下放基础设施 design + plan
│       ├── bugfix/                   # bugfix 分析与修复思路
│       ├── investigation/            # 调研文档（{yyyy-MM-dd-name}/ 或单文件）
│       └── backlog.md                # 待办事项
├── .github/
│   └── workflows/
│       ├── build-and-release.yml     # Git tag 触发的 CI：mac/win 并行构建 + GitHub Releases 发布 + OSS 镜像/latest.json + 末尾 dispatch deploy-pages 联动 web 部署
│       ├── pr-build.yml              # PR 触发的 CI：checkout + npm ci + npm run verify（lint/build/typecheck/单测/i18n check）
│       └── deploy-pages.yml          # main 分支 landing/web/i18n 变更或发版流水线 workflow_dispatch 触发的 CI：构建并部署到 GitHub Pages
├── .husky/
│   └── pre-commit                    # Husky pre-commit 钩子（执行 npm run lint）
├── AGENTS.md                         # agent/新成员入口：文档地图 + 命令 + 红线（细节单一权威来源 + 链接）
├── opencode.json                     # opencode 配置
├── eslint.config.js                  # ESLint 9 flat config（全仓库 lint 规则）
├── package.json                      # npm workspace root
└── tsconfig.base.json                # 共享 TypeScript 配置
```
