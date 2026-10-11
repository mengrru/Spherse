# Plan：settings 改造

按依赖拓扑排序（core/contracts → server → desktop → app → web），每阶段完成后跑对应 workspace 测试。

## Phase A：contracts + core

- [x] `packages/contracts/src/settings.ts`：新增 `customProviderDef`、`modelSettingsRequest`、`modelSettingsResponse` schema 与 Static 类型；`index.ts` 导出面镜像契约面；parser 单测（apiKey 三态结构、非 secret 全量替换、sanitized 视图）
- [x] `packages/core/src/types.ts`：新增 `ModelSettings`；删 `AppSettings`、`ThemeMode`；`MobileAccessSettings`/`MobileTunnelMode` 保留待 desktop 阶段一起挪（desktop 定义后从 core 删除）；`index.ts` 导出面同步

## Phase B：server

- [x] `packages/server/src/model-settings.ts`：`ModelSettingsStore`（load / sanitize / mergeApply / persist，tmp+rename 原子写；无 path = 内存模式）；`applyModelSettingsToEnv`（provider key 按 catalog envKeys + restore-on-remove + `SPHERSE_IMAGE_*`）；`syncCustomProviders` 接 catalog。单测：merge 语义（apiKey 三态、defaultModel `""` 守卫语义、sampling/thinkingLevel 覆盖、customProviders 全量替换）、env restore、原子写、内存模式
- [x] `packages/server/src/index.ts`：`CreateServerOptions.modelSettingsPath`；server 自建 `ModelCatalog`（desktop 不再传，options 保留）；启动链 load → env → syncCustomProviders → registry 构造参数；移除 `defaultModel`/`sampling`/`thinkingLevel` options（registry 从 store 拿）
- [x] `packages/server/src/routes/settings.ts`：`GET/PUT /api/settings/models`（response 过 contracts schema；PUT 后 fan-out `registry.setDefaultModel/setSampling/setThinkingLevel`，保留 `if (defaultModel)` 守卫）；`routes/index.ts` 接线传 store。wire 契约测试（fastify inject，对齐 settings-sidepanel.test.ts 模式）
- [x] 既有 server 测试清理：mock `model-catalog`/options 变化的测试

## Phase C：desktop

- [x] `packages/desktop/electron/settings.ts` 改造：`hostPrefs` key（get/save + 缺省 merge + 副作用 `applyThemeSource`/`syncTray`）；`mobileAccess` 顶层 key；`getServerToken` 不动；删除 `getMaskedSettings`/`saveSettings`/`mergeModelGroup`/`maskModelGroup`/`applySettingsToEnv`/`restoreEnvFromSettings`；所有 `getLocale()` 改读 hostPrefs（tray/context-menu/project）
- [x] `packages/desktop/electron/migrate-legacy-settings.ts`：先 `getServerToken()` 触发提升 → seed model-settings.json（文件已存在跳过）→ hostPrefs（key 已存在整体跳过）→ mobileAccess 顶层（已存在保留顶层）→ 删旧 `settings` key → `applyThemeSource`；`main.ts` 启动链接线（ensureServer 之前）。单测三态幂等
- [x] `packages/desktop/electron/server.ts`：`ensureServer` 传 `modelSettingsPath`，删 defaultModel/sampling/thinkingLevel/catalog 注入；删 `model-catalog.ts`、`updateDefaultModel`/`updateSampling`/`updateThinkingLevel`
- [x] IPC：`ipc/settings.ts` → `get-host-prefs`/`save-host-prefs`；删 `get-supported-providers`/`get-image-providers`；`preload.ts` 同步；`ipc/debug.ts` reset-app-data 删 `model-settings.json`；`ipc/mobile.ts` 读顶层 mobileAccess
- [x] `packages/desktop/src/host-bridge-electron.ts`：`prefs` + `desktopPrefs`，删 `getSettings`/`saveSettings`/`getSupportedProviders`/`getImageProviders`
- [x] desktop 测试清理：settings.test.ts / server.test.ts / ipc/settings.test.ts 等按新结构重写或删除

## Phase D：app

- [x] `packages/app/src/lib/host-bridge.ts`：`GeneralPrefs`/`DesktopPrefs` 类型、`prefs`（必需）/`desktopPrefs?`（可选）API；删 `HostSettings`/`getSettings`/`saveSettings`/`getSupportedProviders`/`getImageProviders`/`capabilities.tray`；`host-capabilities.structure.test.ts` 同步
- [x] `packages/app/src/lib/api.ts`：`createGlobalApiClient` 加 `getModelSettings`/`updateModelSettings`/`getSupportedProviders`/`getImageProviders`；项目级 client 的两个 provider 方法移除
- [x] `packages/app/src/stores/settings-store.ts` → prefs store：locale 走 `bridge.prefs`，desktop 四项走 `bridge.desktopPrefs`；App.tsx 接线
- [x] `packages/app/src/features/settings/`：`types.ts` SettingsApi 拆分；`use-settings-form.ts` 改走 HTTP（configured map、空值 blur no-op、disconnect `apiKey: ""`、connect 非空）；`ModelProviderItem.tsx` configured 徽标；`DefaultModelField.tsx` configured 过滤；`index.tsx` tab 门控（models/general/help 全平台；mobile/about capability；general desktop 四项按 desktopPrefs）
- [x] `packages/app/src/features/agent-dialog/AgentDialogForm.tsx`：provider 过滤迁移到全局 client GET configured
- [x] `packages/app/src/lib/feature-registry.ts`：`settings` → `ALL_HOSTS`
- [x] app 测试：settings-store.test.ts / use-settings-form 测试 / settings index 结构测试重写

## Phase E：web

- [x] `packages/web/src/host-bridge-web.tsx`：`prefs` localStorage `spherse:prefs`（`scopedStorageKey` 作用域）+ 旧 `spherse:settings` 首读迁移后删除；删旧 settings 读写

## Phase F：i18n + E2E + 文档

- [x] i18n：按需新增文案三语（连接失败/离线错误态等），`npm run check:i18n`
- [x] E2E：`close-to-tray.spec.ts` 改用 hostPrefs IPC；新写 settings 保存链路 spec
- [x] doc-sync：data-conventions「应用级数据」节、architecture（desktop/server/index/frontend/i18n）、project-structure、server/contracts README、backlog 87

## Phase G：收尾

- [ ] `npm run verify`；修复 fallout
- [ ] commit（feat: 前缀）
- [ ] code-review skill 派 sub agent 审查，处理反馈
