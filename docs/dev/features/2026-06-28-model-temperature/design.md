# 文本模型高级设置：全局 Temperature 调节

- **Date**: 2026-06-28
- **Status**: Design
- **Backlog**: 新增 `[ ] settings 文本模型支持全局 temperature 调节（高级设置，默认不传=provider 默认）`

## 1. 背景与动机

当前 app 设置（`Settings` 弹窗 → 文本模型 tab）只允许配置「默认模型」与各 provider 的 API Key，**无法调节任何模型采样参数**。`SessionRuntime.buildAgent()`（`packages/core/src/session-runtime.ts:185-195`）构造 `Agent` 时，`streamFn: getChatStreamFn()` 不附带任何采样参数，全部使用 provider 默认。

少数高级用户有明确需求去微调 `temperature`（例如角色扮演场景希望更高随机性、结构化输出场景希望更低）。但 temperature 这类参数「改错会让模型输出明显劣化」，因此应当：

1. 默认完全不动（不传 = 用 provider 默认），保证开箱即用体验不变；
2. 放进一个不显眼的「高级设置」折叠区，并配明确警示文案；
3. 只在「文本模型」路径生效（生图走 env，与采样参数无关）。

本特性即在「文本模型」tab 内新增一个可折叠的「高级设置」区，提供**全局** temperature 调节（与 `defaultModel` 同级的全局默认，不做 per-agent 覆盖）。

### 关键技术约束

`@earendil-works/pi-ai@0.80.2` 的 `StreamOptions`（`pi-ai/dist/types.d.ts:44-120`）**原生支持 `temperature?: number`**，但**没有类型化的 `topP` 字段**（`top_p` 跨 provider 支持不均，需 `onPayload` 改写原始 payload，代价高且行为不可预期）。

> 注：pi-ai 0.80.2 已从旧全局 API（`streamSimple`/`getModel` 等）迁移到 `createModels()` provider-factory API（见 `docs/dev/infra/2026-06-28-pi-deps-upgrade-0802/design.md`）。stream 函数现在是 `Models` 实例的方法 `models.streamSimple(model, ctx, opts)`，通过 `packages/core/src/model-providers/index.ts:157` 的 `getChatStreamFn()` 暴露给 `SessionRuntime`。temperature 注入点相应落在 `getChatStreamFn()`，而非直接包装 `streamSimple`。

**本期范围只实现 temperature**（pi-ai 原生字段，跨 provider 稳定）。`top_p` 暂不实现，待后续确认 provider 覆盖后再单独立项。

## 2. 目标

- 在「文本模型」tab 的「默认模型」选择下方，新增可折叠的「高级设置」区
- 高级区内提供 `temperature` 数字输入框（复用现有 number `Input`，不新增 UI 组件）
- temperature 为**可选**：留空 = 不传给 pi-ai = 使用 provider 默认值；填入数值后才覆盖
- 提供明确的警示文案：修改会影响模型输出，没有明确需求不要改动
- 提供一键「恢复默认」操作，清空回 unset 状态
- 设置即时保存（沿用现有 settings 表单「改动即存」模式）
- 保存后对**之后新建/恢复的会话**生效（与现有 `setDefaultModel` 语义一致：不热替换已存在的活跃 agent）
- 仅作用于文本模型路径；生图不受影响

## 3. 非目标

- 不实现 `top_p`（pi-ai 无类型化字段，跨 provider 不稳；后续单独立项）
- 不实现 per-agent / per-session temperature 覆盖（仅全局默认，与 `defaultModel` 同级）
- 不新增 Slider 组件（用现有 number `Input`）
- 不为 temperature 做硬性上限 clamp（provider 上限各异；仅做「≥0、必须是数字」的软校验，靠 helper text 提示典型范围）
- 不改 image 模型路径（生图采样参数概念不同，走 env）
- 不改 agent profile 数据结构（`AgentProfile` 不增加 temperature 字段）

## 4. 架构设计

### 4.1 整体方案

temperature 的链路**完全镜像现有 `defaultModel` 链路**：从 app settings 持久化，经 IPC 落盘 + 触发运行期更新，沿 `ProjectRegistry → SessionRuntime` 传播，最终在 `buildAgent()` 构造 `Agent` 时通过 `getChatStreamFn(temperature)` 注入 `{ temperature }` 到 `models.streamSimple` 的 options。

```
┌─ RENDERER ──────────────────────────────────────────────┐
│ SettingsModal → SettingsTabs → ModelGroupTab (text)      │
│   ├ DefaultModelField (现有)                              │
│   ├ [新增] AdvancedSettings Collapsible                  │
│   │     ├ 警示文案                                         │
│   │     ├ temperature number Input + 恢复默认 Button      │
│   │     └ helper text（典型范围 0–2）                     │
│   └ ModelProviderItem list (现有)                         │
│                                                          │
│ useSettingsForm                                          │
│   └ GroupData 新增 temperature?: number                  │
│   └ save() payload 的 text group 带 temperature          │
└──────────────────────────────────────────────────────────┘
                       │ IPC: save-settings
                       ▼
┌─ ELECTRON MAIN ──────────────────────────────────────────┐
│ ipc/settings.ts save-settings handler                    │
│   ├ saveSettings() → electron-store                      │
│   │   ├ mergeModelGroup 透传 temperature (须改)          │
│   │   └ maskModelGroup 透传 temperature (须改)           │
│   └ [新增] updateTemperature(temperature)                │
│       └ registry.setTemperature()                        │
└──────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─ SERVER ─────────────────────────────────────────────────┐
│ ProjectRegistry.setTemperature()                         │
│   ├ 存 this.temperature                                  │
│   └ 遍历 projects → sessionRuntime.setTemperature()      │
└──────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─ CORE ───────────────────────────────────────────────────┐
│ model-providers/index.ts                                 │
│   └ getChatStreamFn(temperature?)                         │
│       └ (model, ctx, opts) => models.streamSimple(        │
│             model, ctx, { ...opts,                        │
│               ...(temperature != null                     │
│                 ? { temperature } : {}) })                │
│                                                          │
│ SessionRuntime                                           │
│   ├ 新增 globalTemperature?: number + setTemperature()   │
│   └ buildAgent(): streamFn: getChatStreamFn(             │
│         this.globalTemperature)                          │
└──────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─ PI-AI (external) ──────────────────────────────────────┐
│ models.streamSimple(model, ctx, SimpleStreamOptions)     │
│   └ temperature?: number  ✅ 原生字段，跨 provider 稳定  │
└──────────────────────────────────────────────────────────┘
```

**为何选此方案（方案 A）而非其他：**

- **方案 B（在 Agent 构造参数里传 temperature）**：`Agent` 的 `AgentOptions` 不直接接收 stream options；采样参数只能通过 `streamFn` 透传。因此必须在 stream fn 构造层注入（现已集中在 `getChatStreamFn()`），方案 B 不成立。
- **方案 C（用 env / config 注入）**：temperature 不是 env 风格的密钥/开关，env 机制只适用于 API key 与 image model 标识；temperature 需要随每次 stream 调用传入 options，方案 C 不成立。

方案 A 与现有 `globalDefaultModel` 的实现路径逐字对应，复用既有传播机制（构造期注入 + setter 运行期更新）。注入点 `getChatStreamFn(temperature)` 是 pi-ai 0.80.2 升级后 stream fn 的唯一构造入口（`session-runtime.ts:193` 是其唯一调用方），在此处注入与升级后的架构一致。

### 4.2 数据模型

#### `packages/core/src/types.ts` — `ModelGroupSettings` 新增可选字段

```ts
export interface ModelGroupSettings {
  defaultModel: string;
  providers: Record<string, ProviderCredentials>;
  temperature?: number;   // 新增；undefined = 用 provider 默认
}
```

`temperature` 仅在 `text` group 上有语义；`image` group 的 `temperature` 字段即便存在也不会被读取（image 走 env，见非目标）。类型上共用 `ModelGroupSettings` 即可，无需为 image 单独建型。

`AppSettings` 结构不变（仍 `{ locale, models: { text, image } }`），新增字段自动随 `models.text` 流转。

### 4.3 持久化层改动（关键：merge/mask 必须透传）

`packages/app/electron/settings.ts` 现有两个函数当前只返回 `{ defaultModel, providers }`，**会丢弃任何新增字段**，必须显式透传 `temperature`：

- `maskModelGroup`（`:32`）：temperature 非敏感信息，无需脱敏，但要透传给 renderer 以便回显当前值：
  ```ts
  return { defaultModel: group?.defaultModel ?? "", providers, temperature: group?.temperature };
  ```
- `mergeModelGroup`（`:54`）：incoming 优先，回退 prev：
  ```ts
  const temperature = incoming?.temperature ?? prev?.temperature;
  // ... return { defaultModel, providers, temperature };
  ```

> 注意：`maskModelGroup` 返回类型是 `ModelGroupSettings`，加了 `temperature` 后类型自然吻合；`mergeModelGroup` 同理。image group 走同一对函数，其 `temperature` 为 `undefined`，无副作用。

`applySettingsToEnv`（`:96`）**不改**——temperature 不走 env。

### 4.4 运行期传播链路

#### `packages/core/src/session-runtime.ts`

新增字段与 setter（镜像 `globalDefaultModel` / `setDefaultModel`，`:31,:45-47`）：

```ts
private globalTemperature?: number;

constructor(projectStore, options?: { defaultModel?: string; temperature?: number; logger?: Logger }) {
  // ...
  this.globalTemperature = options?.temperature;
}

setTemperature(temperature: number | undefined): void {
  this.globalTemperature = temperature;
}
```

`buildAgent()`（`:185-195`）注入点——将 temperature 传给 `getChatStreamFn()`：

```ts
return new Agent({
  initialState: { systemPrompt, model, thinkingLevel: "medium", tools },
  sessionId,
  streamFn: getChatStreamFn(this.globalTemperature),
});
```

#### `packages/core/src/model-providers/index.ts` — `getChatStreamFn` 接受 temperature

pi-ai 0.80.2 升级后，`streamSimple` 不再是顶层 import，而是 `Models` 实例的方法。stream fn 的唯一构造入口是 `getChatStreamFn()`（`:157-159`），`session-runtime.ts:193` 是其唯一调用方。在此处注入 temperature：

```ts
export function getChatStreamFn(temperature?: number): StreamFn {
  return (model, context, options) =>
    models.streamSimple(model, context, {
      ...options,
      ...(temperature != null ? { temperature } : {}),
    });
}
```

`temperature != null` 同时排除 `undefined` 与 `null`；只有用户显式设值时才注入 `{ temperature }`，否则原样透传 options（保持 provider 默认）。temperature 在 `buildAgent()` 调用时从 `SessionRuntime.globalTemperature` 读取，被 StreamFn 闭包捕获——与 `globalDefaultModel` 在同一处读取、同一生命周期生效。

#### `packages/core/src/factory.ts` — `createProject` 透传初始值

`createProject`（`:11-14,:37-40`）的 options 与 `SessionRuntime` 构造增加 `temperature`：

```ts
options?: { projectName?: string; defaultModel?: string; temperature?: number; logger?: Logger }
// ...
const sessionRuntime = new SessionRuntime(projectStore, {
  defaultModel: options?.defaultModel,
  temperature: options?.temperature,
  logger,
});
```

#### `packages/server/src/registry.ts` — `ProjectRegistry`

将构造签名由位置参数 `constructor(logger, defaultModel?)` 改为 options 袋，并新增 `setTemperature`（镜像 `setDefaultModel`，`:104-113`）：

```ts
private temperature?: number;

constructor(logger: Logger, options?: { defaultModel?: string; temperature?: number }) {
  this.logger = logger;
  this.defaultModel = options?.defaultModel;
  this.temperature = options?.temperature;
}

// doRegister 内 createProject 调用带上 temperature
const runtime = await createProject(resolvedRoot, {
  defaultModel: this.defaultModel,
  temperature: this.temperature,
  logger: projectLogger,
});

setTemperature(temperature: number | undefined): void {
  this.temperature = temperature;
  for (const ctx of this.projects.values()) {
    try {
      ctx.sessionRuntime.setTemperature(temperature);
    } catch (err) {
      this.logger.error({ err }, "failed to update temperature for project");
    }
  }
}
```

> 构造签名变更会影响 `createMultiProjectServer` 的调用点，见 4.5。

#### `packages/server/src/index.ts` — `createMultiProjectServer`

options 袋增加 `temperature`，并传给 `new ProjectRegistry`：

```ts
export async function createMultiProjectServer(
  options?: { defaultModel?: string; temperature?: number },
) {
  // ...
  const registry = new ProjectRegistry(logger, {
    defaultModel: options?.defaultModel,
    temperature: options?.temperature,
  });
  // ...
}
```

### 4.5 Electron / IPC 层改动

#### `packages/app/electron/server.ts`

- `ensureServer()`（`:8-15`）：从 settings 读取初始 temperature 传入：
  ```ts
  const result = await createMultiProjectServer({
    defaultModel: settings?.models?.text?.defaultModel,
    temperature: settings?.models?.text?.temperature,
  });
  ```
- 新增 `updateTemperature()`（镜像 `updateDefaultModel`，`:34-37`）：
  ```ts
  export function updateTemperature(temperature: number | undefined): void {
    if (!serverHandle) return;
    serverHandle.registry.setTemperature(temperature);
  }
  ```

#### `packages/app/electron/ipc/settings.ts` — save-settings handler

`save-settings`（`:12-19`）保存后触发运行期更新。注意：现有逻辑是「`if (defaultModel)` 才调用 `updateDefaultModel`」；temperature 的语义不同——**空值（undefined）是合法且需要传播的状态**（代表「恢复 provider 默认」），因此必须无条件调用：

```ts
ipcMain.handle("save-settings", (_event, settings: AppSettings) => {
  saveSettings(settings);
  const defaultModel = settings.models?.text?.defaultModel;
  if (defaultModel) updateDefaultModel(defaultModel);
  updateTemperature(settings.models?.text?.temperature);   // 新增，无条件传播
  return { success: true };
});
```

### 4.6 前端表单改动

#### `packages/app/src/features/settings/use-settings-form.ts`

- `GroupData`（`:14-17`）新增 `temperature?: number`。
- 初始化（`:51-54`）读取 `settings?.models?.text?.temperature`。
- `save()`（`:62-85`）payload 的 text group 带上 temperature（image group 不带，保持 undefined）：
  ```ts
  text: {
    defaultModel: t.defaultModel,
    providers: keysToProviders(t.apiKeys),
    temperature: t.temperature,
  },
  ```
- `makeGroup`（`:87-116`）暴露 `temperature`、`setTemperature(value?: number)`、`resetTemperature()`；`setTemperature` 内 `setData({ ...data, temperature: value })` 后调用 `save(next, undefined)`（沿用 text group 的即时保存模式，参考 `changeDefaultModel` `:99-103`）。

> image group 同样会拿到 `setTemperature`（因 `makeGroup` 通用），但 UI 只在 text tab 渲染高级区，image 的 temperature 永远是 undefined，不会被读取/保存。可选：在 `makeGroup` 内对 image 忽略 temperature，但非必要。

#### `packages/app/src/features/settings/index.tsx` — `ModelGroupTab`

在 `DefaultModelField` 的 `FieldGroup` 之后、`ModelProviderItem` 列表之前（`:45-73`），插入新的 `AdvancedSettings` 折叠区。**仅 text tab 渲染**——`ModelGroupTab` 当前 text/image 共用，需要区分：通过给 `ModelGroupTab` 增加一个 `kind: "text" | "image"` prop（`SettingsTabs` 处已知 kind，`:90-96`），仅 `kind === "text"` 时渲染高级区。

新组件 `packages/app/src/features/settings/AdvancedSettings.tsx`（复用 `Collapsible`，`packages/app/src/components/ui/collapsible.tsx`）：

```tsx
<Collapsible>
  <CollapsibleTrigger>
    <ChevronDownIcon /> {t("settings.models.advanced")}
  </CollapsibleTrigger>
  <CollapsibleContent>
    <p className="text-muted-foreground">{t("settings.models.advancedTip")}</p>
    <Field>
      <FieldLabel>{t("settings.models.temperature")}</FieldLabel>
      <Input
        type="number"
        min={0}
        step={0.1}
        value={temperature ?? ""}
        placeholder={t("settings.models.temperaturePlaceholder")}
        onChange/onBlur → 解析为 number；NaN 或 <0 → undefined
      />
      <Button variant="ghost" size="sm" onClick={resetTemperature}>
        {t("settings.models.temperatureReset")}
      </Button>
      <p className="text-muted-foreground text-xs">
        {t("settings.models.temperatureHint")}
      </p>
    </Field>
  </CollapsibleContent>
</Collapsible>
```

交互细节：
- 输入框 `value={temperature ?? ""}`：unset 时显示空（placeholder「默认」）。
- 保存时机：`onBlur` 解析并保存（避免每次按键都触发 IPC；与 API key 的「connect 按钮触发保存」节奏更接近，避免输入中途频繁落盘）。输入中途的脏值用组件内 `useState` 暂存，blur 时提交回 `setTemperature`。
- 「恢复默认」按钮：调用 `resetTemperature()` → `setTemperature(undefined)` → save。
- 默认折叠（`defaultOpen={false}`），契合「没有明确需求不要动」的产品意图。

### 4.7 不改动

- `applySettingsToEnv` / 任何 env 注入逻辑（temperature 不走 env）
- image 模型选择与生图路径
- `AgentProfile` 类型、agent markdown 解析、agent 创建 API
- server HTTP contracts（app settings 走 Electron IPC，不经 server HTTP；`packages/server/src/contracts/settings.ts` 是 project 级设置 + provider catalog，不涉及）
- pi-ai 调用签名本身（仅包装透传）

## 5. 数据流与生命周期

### 5.1 启动期

```
app 启动 → ensureServer()
  → getSettings() 读 electron-store
  → createMultiProjectServer({ defaultModel, temperature: settings.models.text.temperature })
  → new ProjectRegistry(logger, { defaultModel, temperature })
用户打开项目 → registry.register(root)
  → createProject(root, { defaultModel, temperature, logger })
  → new SessionRuntime(store, { defaultModel, temperature, logger })
  → globalTemperature 已就位
```

### 5.2 运行期（用户改 temperature）

```
用户在高级区输入 0.3 → onBlur
  → useSettingsForm.setTemperature(0.3)
  → setData + save({ models: { text: { ..., temperature: 0.3 } } })
  → IPC save-settings
      ├ saveSettings() → mergeModelGroup 透传 temperature → electron-store
      └ updateTemperature(0.3)
          → registry.setTemperature(0.3)
              → 遍历 projects → sessionRuntime.setTemperature(0.3)
                  → this.globalTemperature = 0.3
用户发消息 → createSession/restoreSession → buildAgent()
  → getChatStreamFn(this.globalTemperature)
      → models.streamSimple(model, ctx, { ...opts, temperature: 0.3 })
      → provider
```

### 5.3 语义边界（即时生效）

`setTemperature` 与 `setDefaultModel` 都对**活跃会话即时生效**：setter 在更新全局字段后，遍历 `activeSessions` 逐个热替换——`setTemperature` 重赋每个 agent 的 `agent.streamFn = getChatStreamFn(this.globalTemperature)`；`setDefaultModel` 对未在 profile 中 pin 模型的 agent 重赋 `agent.state.model = resolveModelById(...)`（profile 显式指定 `model` 的 agent 不受全局默认变更影响）。

- **生效时机**：下一轮（下一条用户消息）。`agent.state.model` 与 `agent.streamFn` 是 pi-agent-core 暴露的可变字段，agent 每轮读取它们构造请求；进行中的流式响应不受打扰，完成后下一轮即用新值。
- **profile pin 的模型不被覆盖**：`setDefaultModel` 的热替换按 `profile.model ?? this.globalDefaultModel ?? config.defaultModel` 重新解析，与 `buildAgent` 同逻辑，因此 profile 显式指定模型的 agent 在全局默认变更时保持其 profile 模型。
- unset（`undefined`）= 不注入 temperature 字段 = provider 默认。这是**默认状态**，也是「恢复默认」按钮的目标态。

## 6. i18n

新增 key（`zh-CN.ts` 为基准并带场景注释，`en.ts` / `zh-TW.ts` 同步）。所有文案结合实际 UI 场景写注释：

| Key | zh-CN | en | zh-TW |
|-----|-------|----|-------|
| `settings.models.advanced` | 高级设置 | Advanced | 進階設定 |
| `settings.models.advancedTip` | 调整这些参数会影响模型的输出表现。如果没有明确的需求，建议保持默认。 | These parameters affect model output. Keep defaults unless you have a specific need. | 調整這些參數會影響模型輸出表現。若無明確需求，建議保持預設。 |
| `settings.models.temperature` | Temperature | Temperature | Temperature |
| `settings.models.temperaturePlaceholder` | 默认 | Default | 預設 |
| `settings.models.temperatureHint` | 通常 0–2，值越低输出越确定，越高越随机。留空使用模型默认值。 | Typically 0–2. Lower = more deterministic, higher = more random. Leave empty for model default. | 通常為 0–2，值越低輸出越確定，越高越隨機。留空使用模型預設值。 |
| `settings.models.temperatureReset` | 恢复默认 | Reset to default | 恢復預設 |

注释示例（zh-CN）：
```ts
// 文本模型 tab → 高级设置折叠区标题（点击展开/收起 temperature 等参数）
"settings.models.advanced": "高级设置",
// 高级设置折叠区顶部的警示文案（提示用户改参数有副作用、无需求不要动）
"settings.models.advancedTip": "调整这些参数会影响模型的输出表现。如果没有明确的需求，建议保持默认。",
// 高级设置 → temperature 数字输入框的标签
"settings.models.temperature": "Temperature",
// 高级设置 → temperature 输入框的 placeholder（未设置时显示，代表用 provider 默认）
"settings.models.temperaturePlaceholder": "默认",
// 高级设置 → temperature 输入框下方的范围说明与行为提示
"settings.models.temperatureHint": "通常 0–2，值越低输出越确定，越高越随机。留空使用模型默认值。",
// 高级设置 → temperature「恢复默认」按钮（清空回 unset 状态）
"settings.models.temperatureReset": "恢复默认",
```

完成后运行 `npm run check:i18n` 校验 key 与插值变量一致性。

## 7. 错误处理

- **非法输入**（非数字 / 负数 / 空字符串）：`onBlur` 解析时 `NaN` 或 `< 0` 一律视为 unset → 保存 `undefined`。不弹错误、不阻塞，输入框回空。不做硬性上限 clamp（provider 上限各异，靠 helper text 提示）。
- **save 失败**：沿用现有 `save()` 的 try/catch（`use-settings-form.ts:78-80`），返回 `false`；可复用现有「保存失败」toast（`settings.models.saveFailed` 已存在）。
- **server 未启动时改 temperature**：`updateTemperature` 内 `if (!serverHandle) return`（镜像 `updateDefaultModel`），不会抛错；temperature 仍已落盘，下次 `ensureServer()` 启动时从 settings 读取并注入。
- **merge 丢失**：4.3 已说明 `mergeModelGroup` / `maskModelGroup` 必须显式透传 temperature，否则字段会被丢弃（renderer 回显空、跨次保存丢值）。这是实现时的强制检查点。

## 8. 测试覆盖

沿用 TDD，先写测试：

- **`packages/core`（`model-providers/index.ts` — `getChatStreamFn`）**：
  - `getChatStreamFn(0.3)` 返回的 streamFn 调用时 options 含 `temperature: 0.3`
  - `getChatStreamFn(undefined)` 返回的 streamFn options **不含** temperature 字段（保持 provider 默认）
- **`packages/core`（`SessionRuntime`）**：
  - 构造时传入 `temperature` → `buildAgent()` 产生的 streamFn 调用时 options 含 `temperature`
  - `setTemperature(t)` 后再 `buildAgent()` → 注入新值
  - `temperature === undefined` → streamFn options **不含** temperature 字段（保持 provider 默认）
  - 已有 agent 不受 `setTemperature` 影响（仅新 buildAgent 生效）
- **`packages/core`（`factory.ts`）**：`createProject({ temperature })` → `SessionRuntime.globalTemperature` 就位
- **`packages/app`（electron settings merge/mask）**：
  - `mergeModelGroup` incoming 带 temperature → 结果带；incoming 无、prev 有 → 回退 prev；都无 → undefined
  - `maskModelGroup` 透传 temperature（不脱敏、不丢失）
- **`packages/app`（`useSettingsForm`）**：
  - 初始化读取 `settings.models.text.temperature` 回显
  - `setTemperature(0.3)` → save payload 的 text group 带 `temperature: 0.3`
  - `resetTemperature()` → save payload 带 `temperature: undefined`
  - image group 永不带 temperature
- **`packages/app`（`AdvancedSettings` 组件）**：
  - 默认折叠
  - 输入合法值 blur → 回调提交；输入非法/空 → 提交 undefined
  - 「恢复默认」→ 调用 reset
- **i18n**：`npm run check:i18n` 通过

## 9. 影响面

### 9.1 代码改动清单

| 文件 | 改动 |
|------|------|
| `packages/core/src/types.ts` | `ModelGroupSettings` 新增 `temperature?: number` |
| `packages/core/src/session-runtime.ts` | 新增 `globalTemperature` + `setTemperature()`；`buildAgent()` 调用 `getChatStreamFn(this.globalTemperature)`；构造 options 增 `temperature` |
| `packages/core/src/model-providers/index.ts` | `getChatStreamFn(temperature?)` 注入 `{ temperature }` 到 `models.streamSimple` options |
| `packages/core/src/factory.ts` | `createProject` options 增 `temperature` 并透传给 `SessionRuntime` |
| `packages/core/__tests__/` | 新增/补充 SessionRuntime temperature 注入测试、factory 透传测试 |
| `packages/server/src/registry.ts` | 构造改 options 袋（含 temperature）；`doRegister` 透传；新增 `setTemperature()` |
| `packages/server/src/index.ts` | `createMultiProjectServer` options 增 `temperature`，传给 `ProjectRegistry` |
| `packages/app/electron/settings.ts` | `maskModelGroup` / `mergeModelGroup` 透传 `temperature` |
| `packages/app/electron/server.ts` | `ensureServer()` 传初始 temperature；新增 `updateTemperature()` |
| `packages/app/electron/ipc/settings.ts` | save-settings handler 调用 `updateTemperature()`（无条件） |
| `packages/app/src/features/settings/use-settings-form.ts` | `GroupData` 增 temperature；初始化读取；save payload 带 temperature；`makeGroup` 暴露 `setTemperature`/`resetTemperature` |
| `packages/app/src/features/settings/index.tsx` | `ModelGroupTab` 增 `kind` prop；text tab 渲染 `AdvancedSettings` |
| `packages/app/src/features/settings/AdvancedSettings.tsx` | 新增组件（Collapsible + 警示 + Input + reset） |
| `packages/app/src/features/settings/types.ts` | 如 `SettingsApi`/类型需调整（视实现） |
| `packages/i18n/src/locales/zh-CN.ts` | 新增 `settings.models.advanced*` / `temperature*` key（带注释） |
| `packages/i18n/src/locales/en.ts` | 同步 |
| `packages/i18n/src/locales/zh-TW.ts` | 同步 |

### 9.2 文档同步（`docs/official/`）

- **`architecture.md`** §「默认模型切换」：补充 temperature 的传播链路说明（`SessionRuntime.setTemperature` → `buildAgent` 注入），明确「仅文本路径生效、unset=provider 默认、仅对新会话生效」。
- **`project-structure.md`**：在 settings feature 目录说明中补一条「高级设置（temperature）」。

### 9.3 Backlog 维护

- 完成后标记 `[x] settings 文本模型支持全局 temperature 调节`。
- 新增后续 backlog：`[ ] 文本模型高级设置支持 top_p（需先确认 pi-ai 各 provider 的 top_p 覆盖与注入方式）`。

## 10. 决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| top_p 是否纳入本期 | 否 | pi-ai 无类型化 `topP` 字段，跨 provider 不稳；temperature 原生支持、稳定。先 ship temperature。 |
| temperature 默认值语义 | 可选，空=provider 默认 | 贴合「没有明确需求不要修改」的产品意图；unset 即不传，零行为变更。 |
| 输入控件 | number Input | 不新增 Slider 组件，范围最小；number Input 配 placeholder + helper text 足够。 |
| 作用范围 | 仅全局默认 | 与 `defaultModel` 同级，不扩 agent profile，控制改动面。 |
| 生效时机 | 仅新会话 | 与 `setDefaultModel` 既有语义一致；不热替换活跃 agent。 |
| 保存时机 | onBlur | 避免每次按键触发 IPC；与 API key「connect 触发保存」节奏一致。 |
| 是否硬 clamp 上限 | 否 | provider 上限各异；仅 `≥0` 软校验，靠 hint 提示典型 0–2。 |
