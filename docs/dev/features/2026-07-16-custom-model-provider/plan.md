# 自定义模型供应商 — Implementation Plan

- Feature design: `./design.md`
- Mode: subagent-driven（每个 task 独立可验证；标注 deps 决定可并行度）

## 任务依赖图

```
Layer 0（可并行，无相互依赖）:
  T1 core 类型+注册   T4 i18n 文案   T5 id 工具

Layer 1（可并行）:
  T2 contract schema ── 依赖 T1(类型)
  T3 electron 持久化  ── 依赖 T1
  T6 form hook       ── 依赖 T1, T5
  T7 ModelProviderItem ── 依赖 T4
  T8 CustomProviderDialog ── 依赖 T4

Layer 2:
  T9 index.tsx 装配 ── 依赖 T6, T7, T8

Layer 3:
  T10 最终验证（lint/build/test/i18n check）
```

全局约定：
- 每个 task 结束自带其 lint + 该 package 测试，绿了才算完成。
- TypeScript strict；ESM；Node16 moduleResolution（import 带 `.js` 后缀）。
- 不加注释（除非用户要求）。
- 不改 pi-ai 上游。

---

## T1 — core：类型 + 自定义 provider 注册

**包**：`packages/core`

**改动**：`src/types.ts`
- 新增 `CustomProviderDef { id: string; name: string; baseUrl: string; models: string[]; keyless: boolean }`。
- `AppSettings` 增 `customProviders?: CustomProviderDef[]`。
- `ProviderCatalogItem` 增可选 `custom?: boolean`、`keyless?: boolean`、`baseUrl?: string`。

**改动**：`src/model-providers/index.ts`
- `models` 类型从 `Models` 改为 `MutableModels`（import 加 `MutableModels`）。
- 顶层加 `let registeredDefs: CustomProviderDef[] = []`、`const customIds = new Set<string>()`、`const KEYLESS_PLACEHOLDER = "sk-no-key"`。
- 新增 `customAuth(apiKey, keyless): ApiKeyAuth`（resolve：有 key 返回 key；keyless 返回占位；否则 `undefined` 视为未配置）。
- 新增 `buildCustomProvider(def, apiKey)`：用 `createProvider({ id, name, baseUrl, auth:{apiKey:customAuth(...)}, models, api: openAICompletionsApi() })`，model cost 全 0、contextWindow 32768、maxTokens 4096、api `"openai-completions"`、input `["text"]`、reasoning false。import：`import { createProvider, type ApiKeyAuth } from "@earendil-works/pi-ai"`、`import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy"`（已确认子路径 exports `./api/*` 存在）。
- 新增并 export `syncCustomProviders(defs, apiKeys: Record<string,string>)`：diff（删除 `customIds` 中不在 next 的 → `models.deleteProvider`）、upsert（`models.setProvider(buildCustomProvider(def, apiKeys[def.id]))`）、末尾 `registeredDefs = defs`。
- `getSupportedProviders()` 内置循环**之后**追加：遍历 `registeredDefs`，填 catalog item（auth.type = `def.keyless ? "unknown" : "apiKey"`、envKeys `[]`、`custom:true`、`keyless`、`baseUrl`）。

**测试**：`__tests__/model-providers/`（新增或追加）
- `syncCustomProviders` add（空→1 个，`models.getProvider("custom-foo")` 存在）、update（改 name/baseUrl 后 provider 刷新）、remove（再同步空数组 → provider 消失、`customIds` 清空）。
- `getSupportedProviders()` 含自定义段，`custom/keyless/baseUrl` 标记正确，模型项 api=`openai-completions`。
- `resolveModelById("custom-foo/some-model")` 返回自定义 model（`baseUrl` = def.baseUrl）。
- keyless：`models.getProvider(id)` 的 auth resolve 返回占位 apiKey；keyed（传 apiKey）返回真实 key；既无 key 又非 keyless → resolve 返回 `undefined`。
- 注意：`getSupportedProviders`/`resolveModelById`/`syncCustomProviders` 均 module 级单例，测试间需 reset（测试内 `syncCustomProviders([], {})` 清理，或在 `beforeEach` 清空）。

**deps**：无。
**verify**：`npm test --workspace=packages/core`、`npm run lint --workspace=packages/core`、`npm run build --workspace=packages/core`。

---

## T2 — server：contract schema 可选字段

**包**：`packages/server`

**改动**：`src/contracts/settings.ts`
- `providerCatalogItem` 增 `custom: Type.Optional(Type.Boolean())`、`keyless: Type.Optional(Type.Boolean())`、`baseUrl: Type.Optional(Type.String())`（均为可选，不破坏既有响应校验）。
- route handler `/api/settings/providers`（`routes/settings.ts:9-14`）**不改**（`getSupportedProviders()` 已含自定义项）。

**测试**：`src/__tests__/contracts/api-contracts.test.ts` 追加 case：带 `custom/keyless/baseUrl` 的 catalog item 能通过 `parseApiResponse(schemas.providerCatalog, ...)` 校验。

**deps**：T1（core 的 `ProviderCatalogItem` 类型与之对应；不强依赖，但类型一致更稳）。
**verify**：`npm test --workspace=packages/server`、`npm run lint --workspace=packages/server`。

---

## T3 — electron：持久化 + 启动注册 + IPC 类型

**包**：`packages/app`（electron 层）

**改动**：`shared/electron-api.ts`
- `IpcAppSettings` 增 `customProviders?: CustomProviderDef[]`（import `CustomProviderDef` from `@spherse/core`，与既有 `ModelGroupSettings` 同来源）。

**改动**：`electron/settings.ts`
- `saveSettings(incoming)`：`customProviders: incoming.customProviders ?? prev?.customProviders ?? []`（无密钥，整体替换）。既有 `mergeModelGroup` 复用（自定义 apiKey 走同一 providers map 的 mask/merge，无需额外改）。
- `getMaskedSettings()`：透传 `customProviders: settings.customProviders ?? []`（无密钥，无需 mask）。
- `applySettingsToEnv(settings)`：末尾新增 `syncCustomProviders(settings.customProviders ?? [], extractKeys(settings.models?.text?.providers))`，其中 `extractKeys` 复用本地等价逻辑（把 `{id:{apiKey}}` 收成 `{id:key}`）。import `syncCustomProviders` from `@spherse/core`。
- 启动链路无需额外改（`main.ts:10` 已调 `restoreEnvFromSettings()` → `applySettingsToEnv()` → 新增的 `syncCustomProviders`，在 `ensureServer()` 之前）。

**测试**：`electron/settings.test.ts`
- `saveSettings`：incoming 带 `customProviders` → store 持久化；incoming 无 → 保留 prev。
- `getMaskedSettings`：透传 customProviders（无脱敏）。
- `removeCustomProvider` 关联 defaultModel 清空：由前端处理（electron 层只整体存 def，不感知 defaultModel 联动），本测试聚焦 customProviders merge/透传。

**deps**：T1（`syncCustomProviders` + `CustomProviderDef`）。
**verify**：`npm test --workspace=packages/app`、`npm run lint --workspace=packages/app`。

---

## T4 — i18n：文案（zh-CN 基准 + en + zh-TW）

**包**：`packages/i18n`

**改动**：`src/locales/zh-CN.ts`（基准，每条带 UI 场景注释）+ `en.ts` + `zh-TW.ts` 新增 key（design §i18n 列表）：
- `settings.provider.addCustom`（「+ 添加自定义供应商」按钮）
- `settings.provider.customBadge`（行内「自定义」badge）
- `settings.provider.keylessBadge` / `settings.provider.keylessHint`（「无需 API Key」）
- `settings.provider.dialog.titleAdd` / `titleEdit`
- `settings.provider.dialog.name` / `namePlaceholder`
- `settings.provider.dialog.baseUrl` / `baseUrlPlaceholder`（`http://localhost:11434/v1`）
- `settings.provider.dialog.models` / `modelsPlaceholder` / `modelsHint`（逗号或换行分隔）
- `settings.provider.dialog.keyless` / `keylessDesc`
- `settings.provider.dialog.save` / `cancel`
- `settings.provider.dialog.errNameRequired` / `errBaseUrlRequired` / `errBaseUrlInvalid` / `errModelsRequired`

**要求**：三 locale key 集合完全一致（i18n check 会校验）；zh-CN 每条注释说明出现位置/上下文/交互状态。

**deps**：无。
**verify**：`npm test --workspace=packages/i18n`、`npm run lint`、root `npm run verify` 的 i18n check 段（或 `npm run build --workspace=packages/i18n`）。

---

## T5 — app：id 生成工具

**包**：`packages/app`

**改动**：`src/features/settings/custom-provider-id.ts`（新增）
- `slugify(name: string): string`：转小写、非 `[a-z0-9]` 字符转 `-`、合并连续 `-`、去首尾 `-`；空结果 fallback `"provider"`。
- `generateCustomProviderId(name: string, existing: Iterable<string>): string`：`custom-${slugify(name)}`；若与 `existing`（内置 id + 已有自定义 id）冲突，追加 `-2`、`-3`……直到唯一。
- 纯函数，无副作用。

**测试**：`custom-provider-id.test.ts`（与文件同目录）：普通 slug、空名/特殊字符 fallback、冲突去重（`-2`/`-3`）、与内置 id（如 `openai`）冲突也加后缀。

**deps**：无。
**verify**：`npm test --workspace=packages/app`、`npm run lint --workspace=packages/app`。

---

## T6 — app：form hook 接入

**包**：`packages/app`

**改动**：`src/features/settings/use-settings-form.ts`
- import `CustomProviderDef` from `@spherse/core`；import `generateCustomProviderId`。
- 新增 state `customProviders: CustomProviderDef[]`（从 `settings.customProviders ?? []` 加载）。
- `GroupFormState`（或返回对象）扩展 `customProviders`、`addCustomProvider`、`updateCustomProvider`、`removeCustomProvider`。
  - `addCustomProvider(def)`：`generateCustomProviderId(def.name, [...内置 catalog ids, ...已有自定义 ids])` → 设 def.id → `customProviders.concat(def)` → save（payload 带 customProviders）→ **成功后 refetch** `api.getSupportedProviders()` 刷新 `textProviders` catalog（见下方「refetch 约束」）。
  - `updateCustomProvider(id, def)`：替换（保留 id）→ save → refetch catalog。
  - `removeCustomProvider(id)`：过滤掉 def + 清 `apiKeys[id]` + 若 `defaultModel.startsWith(\`${id}/\`)` 则清空 → save → refetch catalog。
- `save()`：payload 在既有 `models` 基础上附带 `customProviders`（从 state 读）。
- `GroupFormState`/返回值的 `text` group 暴露 `customProviders` 与三个方法（image group 不需要，不暴露）。

**refetch 约束（关键）**：catalog（`textProviders`）是渲染 `ModelProviderItem` 列表的真相源，来自 server。增删改自定义供应商会改变 catalog 本身（不只是 apiKey），因此 add/update/remove 成功后**必须**重新 `api.getSupportedProviders()` 并 `setTextProviders(...)`，否则 UI 不更新。

**测试**：`use-settings-form.structure.test.ts`（追加）：断言返回对象含 `customProviders`/`addCustomProvider`/`updateCustomProvider`/`removeCustomProvider`；mock api 验证 add 触发 save（payload 带 customProviders）+ refetch。

**deps**：T1（`CustomProviderDef` 类型）、T5（id 工具）。
**verify**：`npm test --workspace=packages/app`、`npm run lint --workspace=packages/app`。

---

## T7 — app：ModelProviderItem 扩展

**包**：`packages/app`

**改动**：`src/features/settings/ModelProviderItem.tsx`
- props 扩展可选：`onEdit?: () => void`、`onDelete?: () => void`、`baseUrl?: string`、`keyless?: boolean`、`custom?: boolean`。
- `custom` 行：标题区加「自定义」badge；baseUrl 副标题（`text-xs text-muted-foreground`）；右上角加编辑（铅笔图标）/删除（垃圾桶图标）按钮，调用 `onEdit`/`onDelete`。
- `keyless` 行：显示「无需 API Key」badge，**不渲染** apiKey 输入与 connect/disconnect（定义存在即默认可用）。
- keyed 自定义行（custom + 非 keyless）：apiKey 输入 + connect/disconnect，与内置一致。
- 内置行（无 custom）：行为不变（向后兼容）。

**测试**：`ModelProviderItem.structure.test.ts`（新增或追加）：custom 行渲染 baseUrl + 编辑/删除按钮；keyless 行不渲染 apiKey 输入；keyed 自定义行渲染 apiKey 输入；内置行不受影响。

**deps**：T4（badge/按钮文案 i18n key）。
**verify**：`npm test --workspace=packages/app`、`npm run lint --workspace=packages/app`。

---

## T8 — app：CustomProviderDialog 组件

**包**：`packages/app`

**改动**：`src/features/settings/CustomProviderDialog.tsx`（新增）
- props：`open: boolean`、`onClose: () => void`、`onSubmit: (def: CustomProviderDef) => void`、`initial?: CustomProviderDef`（有 = 编辑模式，无 = 新建）。
- 复用 base-ui `Dialog`（`components/ui/dialog`，`open`+`onOpenChange`，参照 `SettingsModal` 用法）。字段：名称（Input）/ Base URL（Input）/ 模型 id（textarea 或 Input，逗号/换行分隔解析为数组）/ keyless（Switch + desc）。
- 校验（提交前）：名称非空、baseUrl 非空且为 `http(s)://` 合法 URL（用 `URL` 构造校验）、解析后 ≥1 个 model id。错误用 inline 文案（T4 的 errXxx key）。
- 提交：组装 `CustomProviderDef`（新建时 id 由 `onSubmit` 调用方用 T5 生成；编辑时保留 `initial.id`）→ `onSubmit(def)` → `onClose()`。

**测试**：`CustomProviderDialog.structure.test.ts`：空名/非法 URL/空模型时禁用提交或显示错误；合法输入提交调用 `onSubmit`；编辑模式 prefill `initial`。

**deps**：T4（i18n key）。
**verify**：`npm test --workspace=packages/app`、`npm run lint --workspace=packages/app`。

---

## T9 — app：index.tsx 装配

**包**：`packages/app`

**改动**：`src/features/settings/index.tsx`（`ModelGroupTab`，仅 `kind === "text"`）
- `ModelGroupTab` 从 `group` 取 `customProviders` 与 add/update/remove 方法（需 T6 在 `text` group 暴露）。
- 现有「模型提供商」列表渲染逻辑：`Object.entries(group.providers).map(...)` 已包含自定义项（catalog 带 `custom` 标记）→ 传 `custom/keyless/baseUrl/onEdit/onDelete` 给 `ModelProviderItem`（`onEdit` 打开编辑 Dialog prefill 该 def；`onDelete` 调 `removeCustomProvider`，可加 confirm）。
- 列表下方加「+ 添加自定义供应商」按钮 → 设置 dialog state 为 `{mode:"add"}` 打开 `CustomProviderDialog`。
- dialog state：`useState<{mode:"add"} | {mode:"edit", def:CustomProviderDef} | null>(null)`。onSubmit：add → `addCustomProvider(def)`；edit → `updateCustomProvider(def.id, def)`。
- image tab（`kind === "image"`）不渲染按钮与自定义行（保持现状）。

**测试**：`index.tsx` 结构测试（若有）或手动验证；确保文本 tab 有添加按钮、image tab 无。

**deps**：T6（form hook 暴露）、T7（ModelProviderItem 扩展）、T8（CustomProviderDialog）。
**verify**：`npm test --workspace=packages/app`、`npm run lint --workspace=packages/app`、`npm run build --workspace=packages/app`。

---

## T10 — 最终验证

**命令**：
- `npm run build`（全 package 编译，确认 core/server/app 类型一致）。
- `npm run lint`（全仓库）。
- `npm test --workspace=packages/core`、`--workspace=packages/server`、`--workspace=packages/i18n`、`--workspace=packages/app`。
- root `npm run verify`（lint + build + unit tests + i18n check）。

**自查清单**：
- [ ] 三 locale i18n key 集合一致。
- [ ] core `syncCustomProviders` 幂等（重复同步相同 defs 不报错）。
- [ ] 启动时 `restoreEnvFromSettings` → `syncCustomProviders` 在 server 起来前执行。
- [ ] add/update/remove 后前端 refetch catalog。
- [ ] `IpcAppSettings.customProviders` 与 core `AppSettings.customProviders` 类型一致。
- [ ] 既有内置供应商 connect/disconnect/defaultModel 行为不变（回归）。

**deps**：T1–T9 全部完成。
