# ADR-0015：settings 分区持久化与模型配置 server 化

- 状态：accepted
- 日期：2026-10-11
- 影响：`packages/contracts`（modelSettings schema）、`packages/server`（model-settings store + 路由 + catalog 所有权）、`packages/desktop`（hostPrefs、迁移、IPC 面）、`packages/app`（HostBridge prefs 分区、settings 表单）、`packages/web`（prefs localStorage）

## 背景

settings 整体由 desktop host 支配：读写走 IPC + electron-store（apiKey mask+merge 双向猜测语义），web 端 settings 被 feature gate 排除且 localStorage 数据是死数据；模型配置的 source of truth 在 desktop 进程（env 注入、custom provider 注册、defaultModel 命令式推送），晚连接的 web 客户端拿不到也改不了；`AppSettings` / `HostSettings` / contracts 三处类型漂移。

## 决策

- **按分区拆存储与通道**：模型配置（models.text/image、customProviders）归 server（`GET/PUT /api/settings/models`，文件路径由 host 注入，desktop 上物理仍在 userData——通道与生命周期归 server）；通用偏好（locale）走 host 本地存储（desktop IPC → electron-store `hostPrefs`，web → localStorage `spherse:prefs`）；桌面专属（theme/tabsEnabled/debugToolsEnabled/closeToTray）走 desktop-only 的 `desktopPrefs` API；mobileAccess 独立顶层 key
- **API key write-only**：GET 只返回 per-provider `configured` 布尔，PUT 时 apiKey 缺省 = 不变、空串 = 清除、非空 = 设置；表单空值 blur 不发字段，清除只经显式 disconnect
- **PUT 语义**：非 secret 字段全量替换（incoming 即真相），`customProviders` 字段缺省 = 保持；保留 defaultModel 空串守卫与 env restore-on-remove
- **ModelCatalog 所有权归 server**：desktop 不再传 `CreateServerOptions.modelCatalog`；启动链 load → env 注入 → syncCustomProviders → registry 构造，全部在 `createMultiProjectServer` 内
- **迁移集中一处**：desktop 启动时 `migrateLegacySettings()`（先触发 serverToken legacy 提升，再拆分旧 `settings` key，幂等）

## 后果

- 正：web/desktop 共用 settings UI（feature gate 解禁）；模型配置多客户端可读写；类型单一权威（contracts schema + core `ModelSettings`）；无 key 回传
- 负：多客户端无实时同步（已打开的表单不刷新，二期加事件）；customProviders headers 仍回传（编辑 UX 需要，后续再 write-only 化）
- 设计详情：`docs/dev/features/2026-10-11-settings-serverization/design.md`
