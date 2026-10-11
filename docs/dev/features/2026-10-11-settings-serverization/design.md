# Settings 改造：脱离 host 支配，web/desktop 共用

## 背景

settings 目前是 desktop 专属 feature（`feature-registry.ts:20` `ELECTRON_ONLY`），读写通道是 HostBridge 私有方法：desktop 走 IPC + electron-store（带 apiKey 脱敏/merge 语义），web 走 localStorage（明文全量覆写，实际是死数据）。模型配置的 source of truth 在 desktop 进程（apiKey 注入 `process.env`、custom provider 注册进 desktop 持有的 `ModelCatalog` 单例、defaultModel/sampling/thinkingLevel 由 desktop 命令式推给 registry），server 无任何全局 settings 存储，晚连接的 web 客户端拿不到也改不了模型配置。`AppSettings`（core）/ `HostSettings`（app 手工镜像）/ contracts 三处类型漂移。

与用户商定的目标拆分：

| 分区 | 内容 | 存储 | 通道 |
|---|---|---|---|
| 模型配置 | `models.text/image`、`customProviders` | **server**（文件路径由 host 注入，desktop 上仍在 userData——本质是通道与生命周期归 server，不是磁盘位置改变） | remote（HTTP API） |
| 通用偏好 | `locale`（本期仅此一项跨平台） | host storage / browser storage | local（desktop: IPC；web: localStorage） |
| 桌面专属 | `theme`、`tabsEnabled`、`debugToolsEnabled`、`closeToTray` | desktop host storage | local（desktop-only API `desktopPrefs`） |
| 移动访问 | `mobileAccess` | desktop host storage（独立 key，不进 prefs） | 维持现有 `bridge.mobile` API 不变 |
| 关于/更新 | updater | 内存 | 维持现状（desktop-only） |

已商定的决策：

1. **API key 不回传**：放弃现有 mask+merge 双向猜测语义，GET 只返回 `configured` 布尔；PUT 时 `apiKey` 缺省 = 不变、空串 = 清除、非空 = 设置
2. **theme 本期 desktop-only**：web 端 theme 应用依赖 renderer 自建机制（`data-theme`/CSS variables），ROI 不高，推迟
3. **分区接口**而非 remote/local 统一抽象：三分区读写语义、可用性（离线）、变更传播完全不同
4. **多客户端变更通知放二期**（server 侧 PUT 已即时 fan-out registry，renderer 侧事件广播二期做）
5. **迁移在 App 启动时触发，集中一处**（desktop main 单模块）

## 设计

### 1. 类型收敛

- core `types.ts`：删除 `AppSettings`、`ThemeMode`；`ModelGroupSettings`、`SamplingParams`、`ThinkingLevel`、`CustomProviderDef`、`ProviderCredentials` 保留；新增 `ModelSettings`：

```typescript
export interface ModelSettings {
  text: ModelGroupSettings;
  image: ModelGroupSettings;
  customProviders: CustomProviderDef[];
}
```

- app `host-bridge.ts`：删除手工镜像的 `HostSettings`；新增

```typescript
export interface GeneralPrefs { locale: string }
export interface DesktopPrefs {
  theme: ThemeMode;            // ThemeMode 移到 app 定义（core 的删除）
  tabsEnabled: boolean;
  debugToolsEnabled: boolean;
  closeToTray: boolean;
}
```

- `MobileAccessSettings`/`MobileTunnelMode` 移到 desktop 包内定义（仅 desktop 消费；app 侧 `MobileAccessState` 已独立存在不受影响）

### 2. wire 协议（contracts/src/settings.ts 新增）

```
GET /api/settings/models   → modelSettingsResponse
PUT /api/settings/models   ← modelSettingsRequest，→ modelSettingsResponse
```

- `modelSettingsResponse`（sanitized 视图，永不含 key）：

```
{ models: { text: { defaultModel, providers: Record<id, { configured: boolean }>, sampling?, thinkingLevel? },
             image: { defaultModel, providers: Record<id, { configured: boolean }> } },
  customProviders: CustomProviderDef[] }
```

- `modelSettingsRequest` 语义——**非 secret 字段全量替换（incoming 即真相），secret 字段三态**：
  - `defaultModel`：incoming 覆盖，允许 `""`（= 未选择，保持现状语义）
  - `sampling`/`thinkingLevel`：incoming 覆盖，`undefined` = 清除（与现状 merge 语义一致，`settings.test.ts:33-49` 钉住）
  - `customProviders`：incoming 全量替换；整个字段缺省 = 保持现状（防止部分 PUT 意外清空用户手工建的 provider 集合）
  - `providers` 值为 `{ apiKey?: string }`——**缺省 = 不变，`""` = 清除，非空 = 设置**
- 新增 `customProviderDef` schema（含 `headers`，本期照常回传，见已知取舍）
- 既有 `GET /api/settings/providers`、`GET /api/settings/image-providers` 不动，renderer 改走 HTTP（web 端免费获得）

### 3. server 侧：ModelSettingsStore

- 新增 `packages/server/src/model-settings.ts`（单文件域，遵守 server README「不开目录」规约）：文件-backed JSON store（tmp+rename 原子写），持有真实 key
- `CreateServerOptions` 加 `modelSettingsPath?: string`：desktop 传 `path.join(app.getPath("userData"), "model-settings.json")`；缺省 = 纯内存（测试友好）
- **启动链**（`createMultiProjectServer` 内）：load → 注入 env → `modelCatalog.syncCustomProviders` → `defaultModel`/`sampling`/`thinkingLevel` 传给 `ProjectRegistry`（取代 desktop `ensureServer` 从 electron-store 读）
- **PUT 链**（新路由 handler）：按上述字段语义 merge → 持久化 → env 注入 → syncCustomProviders → `registry.setDefaultModel/setSampling/setThinkingLevel`（取代 desktop IPC handler 里的 `updateXxx` 命令式推送）。行为对齐点：
  - 保留 `if (defaultModel)` 守卫：`""` 时**不**调 `registry.setDefaultModel`（沿用 ipc/settings.ts:17-20 现状语义「清空后旧默认保留至重启」，desktop.md 已记载为已知边界）
  - env 注入保留 **restore-on-remove** 语义：覆写前记录原 env 值（`envOverrides` map 模式，settings.ts:122-139），key 移除后恢复用户 shell 原值或删除——只 set/delete 会永久吞掉用户同名环境变量
- `ModelCatalog` 生命周期归 server：`CreateServerOptions.modelCatalog` 保留但 desktop 不再传，server 内部自建；desktop 的 `model-catalog.ts` 单例与 `restoreEnvFromSettings`/`applySettingsToEnv` 删除（牵连的既有测试 mock 清理列为 plan 显式任务）

### 4. desktop host prefs

- electron-store 同文件（settings.json）新 key `hostPrefs: { locale, theme, tabsEnabled, debugToolsEnabled, closeToTray }`；`mobileAccess` 迁到顶层独立 key
- IPC 通道：`get-settings`/`save-settings` 替换为 `get-host-prefs`/`save-host-prefs`（全量写 + 缺省 merge）；`get-supported-providers`/`get-image-providers` IPC 删除
- HostBridge 接口变化：

```typescript
prefs: { getPrefs(): Promise<GeneralPrefs>; savePrefs(p: GeneralPrefs): Promise<boolean> };      // 两 host 必需
desktopPrefs?: { getPrefs(): Promise<DesktopPrefs>; savePrefs(p: DesktopPrefs): Promise<boolean> }; // 仅 desktop
```

- `save-host-prefs` 副作用：`nativeTheme.themeSource` 应用 theme、`syncTray()`
- **冷启动 theme**：迁移/启动链在创建 window 前对持久化 `hostPrefs.theme` 调一次 `applyThemeSource`（取代被删除的 `restoreEnvFromSettings` 中的 theme 部分），否则重启回退 system
- main 进程**全部** `getLocale()` 消费点改读 `hostPrefs`：tray（`tray.ts`）、右键菜单（`ipc/context-menu.ts:4,38`）、unsafe-location 确认/启动警告对话框（`ipc/project.ts:14,46,85`）——漏则对话框 locale 静默回退 zh-CN
- `reset-app-data`（`ipc/debug.ts`）同步删除 `model-settings.json`，否则重置后残留全部 API key
- web：localStorage `spherse:prefs`（新 key，只存 `{ locale }`；旧的 `spherse:settings` 读取迁移，见 §6）

### 5. renderer（app）

- **复用既有全局 API client**（`api.ts:747` `createGlobalApiClient` + `use-connection.ts` `useGlobalApiClient`）：加 `getModelSettings`/`updateModelSettings`；`getSupportedProviders`/`getImageProviders` 从项目级 client（api.ts:537-547，现状打的就是全局路由）归位到全局 client。不另立 settings 工厂
- `settings-store.ts` 重构为 prefs store：`locale` 走 `bridge.prefs`；desktop 四项走 `bridge.desktopPrefs`（存在性即门控）
- `use-settings-form.ts`：
  - 表单 key 输入框初始为空，`configured` 驱动「已连接」徽标；`disconnect` 发 `apiKey: ""`，`connect` 发非空值；不再从 GET 结果回填 key
  - **blur 自动 commit 的空值语义**：`ModelProviderItem.tsx:90` 的 `onBlur` commit 是既有自动保存路径，新语义下空串 = 清除——规则改为**空值 blur 不发字段**（no-op），清除只经显式 disconnect 按钮；否则用户 Tab 穿过空输入框就会静默清掉已配置的 key
  - **`configured` 的全部消费点接入**（不止徽标）：`DefaultModelField.tsx:33` 的 `configuredProviders` 过滤改用 `configured` map；`AgentDialogForm.tsx:62-82` 从 `bridge.getSettings()` 取 key 过滤（将被删除的 API）迁移到全局 client 的 GET `configured`
- SettingsModal：models/general/help tabs 全平台；mobile/about tabs 维持 capability 门控；general tab 中 desktop 四项按 `desktopPrefs` 存在性显隐
- `feature-registry.ts`：`settings` → `ALL_HOSTS`。web 入口**复用既有 ActivityBar 齿轮按钮**（web 项目内经 SidePanel 移动抽屉已渲染完整 ActivityBar，齿轮仅被 feature gate 隐藏，翻 ALL_HOSTS 后自动出现）；移动端 bottom-sheet 视觉打磨沿用 backlog 87 待办，不在本期
- 删除 `HostBridge.getSettings/saveSettings/getSupportedProviders?/getImageProviders?` 与 web 的 localStorage settings 读写；`capabilities.tray` 全仓唯一消费方是 settings UI 的 closeToTray 门控，被 `desktopPrefs` 存在性取代后删除声明并同步 `host-capabilities.structure.test.ts`
- E2E：`close-to-tray.spec.ts:81` 直接调 `electronAPI.getSettings()`，随 IPC 更名改造；settings 保存链路无既有专项 spec，**新写**一条覆盖 GET/PUT 往返

### 6. 迁移（集中一处，desktop 启动时）

新模块 `packages/desktop/electron/migrate-legacy-settings.ts`，`main.ts` 启动链在 `ensureServer()` 之前调用一次：

1. **先调 `getServerToken()`**（触发 legacy `settings.mobileAccess.token` → 顶层 `serverToken` 的惰性提升，settings.ts:253-264）：若不先提升就搬走 `mobileAccess` 并删除旧 key，跨越 decision 0010 兼容窗口升级的用户会拿到全新 token，已配对 web 客户端全部失效。本次迁移即 0010 所说「兼容一个版本后的清理时刻」
2. electron-store 存在旧顶层 `settings` key 时（不存在 = no-op，幂等）：
   - `models` + `customProviders` → 用 server 的 `ModelSettingsStore` 直接 seed `model-settings.json`（同进程直接 import，不走 HTTP；**文件已存在则跳过**）
   - `locale/theme/tabsEnabled/debugToolsEnabled/closeToTray` → 写 `hostPrefs`（**key 已存在则整体跳过**，不做字段级合并——避免部分写入状态歧义）
   - `mobileAccess` → 顶层独立 key（**顶层已存在则保留顶层**，旧值丢弃）
3. 删除旧 `settings` key；写 `hostPrefs` 后按 §4 应用一次 `applyThemeSource`
4. `serverToken`/`openProjects`/`lastActiveProject` 不动
5. web 端旧的 `spherse:settings` localStorage 首次读取时并入 `spherse:prefs` 后删除——两边都经 `scopedStorageKey` 作用域（`:dev` 后缀），否则 dev 部署数据漏迁

### 7. 文档同步

- `data-conventions.md` 新增「应用级数据」节：`model-settings.json`（server-owned、路径由 host 注入、含敏感 key）、desktop settings.json 各顶层 key 归属
- architecture 域文件：`desktop.md`（settings 持久化/模型传播/theme 节，:43-71）、`server.md`（ensureServer 装配 :16、settings 路由表 :55）、`index.md` 装配链、`frontend.md`（HostBridge 接口、settings-store、web localStorage key 清单）、`i18n.md`（locale 持久化位置）
- `project-structure.md`（新增/删除文件）、server/contracts README、backlog 87 条目更新（入口已做，视觉打磨保留）

## 已知取舍

- **customProviders `headers` 照常回传**：可能含敏感 auth header，但自定义 provider 编辑 UX 需要回显；本 app 是单用户 token 门控的个人服务，与现状（desktop 明文回传）一致，如需对齐 write-only 语义放后续
- **多客户端无实时同步**：手机改模型配置后 desktop 已打开的 settings 表单不刷新（下次打开取新值）；运行时行为（registry fan-out）是即时的。二期加 settings 变更事件
- **web 离线时 models tab 不可用**（remote 分区天然如此）：错误态提示即可；locale 等 local 偏好不受影响
- **web 连接旧版 desktop server**：`GET /api/settings/models` 404，models tab 报错。依赖 version-guard 兜底的前提是本 feature 随 **minor** 版本发布（version-compat.ts 同 minor 强制、patch 仅 toast），发布时需确认
- **theme 仍 desktop-only**：web 的 `prefers-color-scheme` 跟随系统，无手动切换

## 验证

- contracts：新 schema parser 单测（apiKey 三态、非 secret 全量替换、sanitized 视图）
- server：`model-settings.ts` 持久化 + merge 语义（含 defaultModel `""` 守卫、env restore-on-remove）；**wire 契约测试**——用真实 fastify inject 驱动新路由断言响应 schema（对齐 settings-sidepanel.test.ts 模式）；内存模式（无 path）行为
- desktop：**装配测试**（引入真实 `@spherse/server`）：seed model-settings.json → server 启动读到 defaultModel/custom providers；迁移模块三态幂等（无旧 key / 有旧 key / 目标已存在）+ serverToken 先提升再迁移；`get-host-prefs`/`save-host-prefs` IPC + tray/theme/locale 副作用；reset-app-data 清理 model-settings.json
- app：settings-store 按 bridge.prefs/desktopPrefs 分流；use-settings-form 空值 blur no-op、disconnect 清除语义、configured 过滤接入；SettingsModal tab 门控（web 显示 models/general/help）
- i18n：新增文案三语 + `npm run check:i18n`；lint、typecheck、相关 workspace 单测；`npm run verify` + E2E（新 settings spec + 改造 close-to-tray.spec）

## 二期草图（暂不实施）

- settings 变更事件广播（WS bus 或 SSE）+ 各端 store 刷新，解决多客户端同步
- web theme：renderer 自建 `data-theme` 应用机制，desktop `nativeTheme` 降级为 host 副作用
- customProviders headers 的 write-only 化
