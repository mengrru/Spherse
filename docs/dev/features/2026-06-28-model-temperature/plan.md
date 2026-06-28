# 实施计划：文本模型高级设置（全局 Temperature）

- **Date**: 2026-06-28
- **Design**: `docs/dev/features/2026-06-28-model-temperature/design.md`

## 任务依赖图

```
Task 1 (Core 类型与运行时注入) ──┬──> Task 2 (Server/Electron 传播与持久化) ──┐
                                 │                                            ├──> Task 4 (前端表单与 UI)
Task 3 (i18n 文案) ───────────────┼────────────────────────────────────────────┘        │
  (1 与 3 可并行)                                                            └──> Task 5 (文档同步)
```

- **Task 1** 是地基（定义 `ModelGroupSettings.temperature` 类型 + 运行时注入），所有后续任务依赖它。
- **Task 3** 无依赖，可与 Task 1 并行。
- **Task 2** 依赖 Task 1（需要 `setTemperature` 方法 + 类型）。
- **Task 4** 依赖 Task 2（IPC 契约 `updateTemperature`）+ Task 3（i18n key）。
- **Task 5** 最后，依赖全部完成。

> 每个 Task 的完整设计与代码片段见 design doc 对应章节，本计划只列改动点与验证步骤，便于 subagent 按节执行。

---

## Task 1 — Core 类型与运行时注入

**目标**：定义 `temperature` 数据字段，并在 `SessionRuntime.buildAgent()` 构造 `Agent` 时通过 `getChatStreamFn(temperature)` 注入到 pi-ai stream options。

**设计参考**：design doc §4.2（数据模型）、§4.4（`session-runtime.ts` + `model-providers/index.ts` + `factory.ts`）。

### 1.1 改动文件

| 文件 | 改动 | 设计参考 |
|------|------|---------|
| `packages/core/src/types.ts:77` | `ModelGroupSettings` 新增 `temperature?: number` | §4.2 |
| `packages/core/src/model-providers/index.ts:157` | `getChatStreamFn(temperature?: number)`：返回的 StreamFn 在 options 上注入 `{ temperature }`（`temperature != null` 时） | §4.4 |
| `packages/core/src/session-runtime.ts` | 新增 `globalTemperature?` 字段 + `setTemperature()`；构造 options 增 `temperature`；`buildAgent()` 改为 `streamFn: getChatStreamFn(this.globalTemperature)` | §4.4 |
| `packages/core/src/factory.ts:13` | `createProject` options 增 `temperature`，透传给 `SessionRuntime` 构造 | §4.4 |

### 1.2 关键实现点

- `getChatStreamFn` 注入逻辑：`...(temperature != null ? { temperature } : {})`，`!= null` 同时排除 `undefined`/`null`，保证 unset 时 options 不含 temperature 字段（保持 provider 默认）。
- `buildAgent()` 在 `:185-195`，改 `streamFn: getChatStreamFn()` 为 `streamFn: getChatStreamFn(this.globalTemperature)`。
- 不引入 `as any`（pi-ai 0.80.2 升级后类型已统一）。

### 1.3 测试

新增/扩展 `packages/core` 测试（TDD，先写测试）：

- **`getChatStreamFn` 注入测试**（`__tests__/model-providers/` 或同侧）：
  - `getChatStreamFn(0.3)` 返回的 streamFn 调用时，传给底层 `models.streamSimple` 的 options 含 `temperature: 0.3`
  - `getChatStreamFn(undefined)` → options **不含** temperature 字段
  - 思路：mock/spy `models.streamSimple`，断言收到的 options
- **`SessionRuntime` temperature 测试**（`__tests__/session-runtime*.test.ts`）：
  - 构造时传 `temperature: 0.3` → `buildAgent()` 产生的 agent 调用 streamFn 时 options 含 temperature
  - `setTemperature(0.5)` 后再 `buildAgent()` → 注入新值
  - `setTemperature(undefined)` → 不注入
  - 已存在的 agent 不受 `setTemperature` 影响（仅新 buildAgent 生效）——若现有测试已覆盖 defaultModel 的同类语义，复用其模式

### 1.4 验证

```bash
npm run build --workspace=packages/core
npm test --workspace=packages/core
npm run lint --workspace=packages/core
```

全部通过即 Task 1 完成。

---

## Task 2 — Server/Electron 传播与持久化

**目标**：让 temperature 从 electron-store 持久化，经 IPC → `ProjectRegistry` → `SessionRuntime` 传播；merge/mask 透传字段。

**设计参考**：design doc §4.3（持久化 merge/mask）、§4.4（registry/factory 链路，factory 部分已在 Task 1）、§4.5（electron server.ts + ipc handler）。

### 2.1 改动文件

| 文件 | 改动 | 设计参考 |
|------|------|---------|
| `packages/server/src/registry.ts` | 构造签名改 options 袋 `{ logger, defaultModel?, temperature? }`；`doRegister` 内 `createProject` 传 temperature；新增 `setTemperature()`（镜像 `setDefaultModel:104`） | §4.4 |
| `packages/server/src/index.ts:57` | `createMultiProjectServer` options 增 `temperature`，传给 `new ProjectRegistry` | §4.4 |
| `packages/app/electron/settings.ts:32,54` | `maskModelGroup` / `mergeModelGroup` 透传 `temperature`（关键：否则字段被丢弃） | §4.3 |
| `packages/app/electron/server.ts` | `ensureServer()` 传初始 temperature；新增 `updateTemperature()` | §4.5 |
| `packages/app/electron/ipc/settings.ts:12` | save-settings handler 调用 `updateTemperature(settings.models?.text?.temperature)` —— **无条件**（undefined 是合法状态） | §4.5 |

### 2.2 关键实现点

- **registry 构造签名变更**：从 `constructor(logger, defaultModel?)` 改为 `constructor(logger, options?)`。需同步更新唯一调用方 `packages/server/src/index.ts:57`。
- **merge/mask 透传**（最易出错点）：
  - `maskModelGroup`：`return { defaultModel, providers, temperature: group?.temperature }`
  - `mergeModelGroup`：`temperature: incoming?.temperature ?? prev?.temperature`
  - `applySettingsToEnv` **不改**（temperature 不走 env）
- **IPC handler**：`updateTemperature` 无条件调用（与 `updateDefaultModel` 的 `if (defaultModel)` 守卫不同），因为 `undefined` 代表「恢复 provider 默认」需要传播。

### 2.3 测试

- **electron settings merge/mask 测试**（`packages/app` 下，参考现有 settings-store.test.ts 模式）：
  - `mergeModelGroup`：incoming 带 temperature → 结果带；incoming 无 prev 有 → 回退 prev；都无 → undefined
  - `maskModelGroup`：透传 temperature（不脱敏、不丢失）
- **registry setTemperature 测试**（`packages/server`，若现有 registry 有测试则扩展）：
  - `setTemperature(t)` 后新 register 的 project 的 SessionRuntime 收到 t
- 若 `packages/server` 无 registry 单测，至少保证 `npm test --workspace=packages/server`（contract 测试）通过。

### 2.4 验证

```bash
npm run build --workspace=packages/server
npm test --workspace=packages/server
npm run lint --workspace=packages/server
npm run build --workspace=packages/app   # electron 代码随 app 编译
npm test --workspace=packages/app
```

---

## Task 3 — i18n 文案

**目标**：三个 locale 文件新增 advanced settings 相关 key（无依赖，可与 Task 1 并行）。

**设计参考**：design doc §6。

### 3.1 改动文件

| 文件 | 改动 |
|------|------|
| `packages/i18n/src/locales/zh-CN.ts` | 新增 6 个 key（带场景注释，基准） |
| `packages/i18n/src/locales/en.ts` | 同步 6 个 key |
| `packages/i18n/src/locales/zh-TW.ts` | 同步 6 个 key |

### 3.2 新增 key 清单（见 design doc §6 表格）

- `settings.models.advanced` — 高级设置折叠区标题
- `settings.models.advancedTip` — 警示文案（改参数影响输出，无需求不要动）
- `settings.models.temperature` — 输入框标签
- `settings.models.temperaturePlaceholder` — placeholder「默认」
- `settings.models.temperatureHint` — 范围说明（0–2）
- `settings.models.temperatureReset` — 「恢复默认」按钮

zh-CN 每条 key 上方写场景注释（说明出现位置/交互状态），en / zh-TW 同步翻译值。插入位置：现有 `settings.models.*` 区块之后（约 `zh-CN.ts:29` 附近）。

### 3.3 验证

```bash
npm run check:i18n   # key + 插值变量一致性
npm test --workspace=packages/i18n
```

---

## Task 4 — 前端表单与 UI

**目标**：`useSettingsForm` 管理 temperature 表单状态；新增 `AdvancedSettings` 折叠组件（仅 text tab）；即时保存。

**前置**：Task 2（IPC `updateTemperature` 契约 + merge/mask 透传，保证回显/保存链路通）、Task 3（i18n key）。

**设计参考**：design doc §4.6。

### 4.1 改动文件

| 文件 | 改动 | 设计参考 |
|------|------|---------|
| `packages/app/src/features/settings/use-settings-form.ts` | `GroupData` 增 `temperature?`；初始化读取；`save()` text group 带 temperature；`makeGroup` 暴露 `temperature` / `setTemperature(value?)` / `resetTemperature()` | §4.6 |
| `packages/app/src/features/settings/AdvancedSettings.tsx` | **新增**组件：`Collapsible` + 警示文案 + number `Input`（onBlur 保存）+ 「恢复默认」Button | §4.6 |
| `packages/app/src/features/settings/index.tsx` | `ModelGroupTab` 增 `kind: "text"\|"image"` prop；`SettingsTabs` 传 kind；仅 `kind==="text"` 时在 DefaultModelField 之后渲染 `<AdvancedSettings>` | §4.6 |
| `packages/app/src/features/settings/types.ts` | 如 `GroupFormState`/`SettingsApi` 类型需调整（视实现） | §4.6 |

### 4.2 关键实现点

- **即时保存**：`setTemperature(value)` 内 `setData` 后调 `save(next, undefined)`（沿用 text group 的 `changeDefaultModel` 模式）。
- **onBlur 保存节奏**：组件内 `useState` 暂存输入脏值，`onBlur` 时解析并提交回 hook 的 `setTemperature`；避免每次按键触发 IPC。解析：`Number(value)`，`NaN` 或 `< 0` → `undefined`。
- **image group**：`makeGroup` 通用，image 也会拿到 `setTemperature`，但 UI 只在 text tab 渲染，image temperature 永远 undefined，不会被读取/保存。
- **默认折叠**：`<Collapsible defaultOpen={false}>`，契合「没有明确需求不要动」。
- **样式**：用语义 token（`text-muted-foreground`）+ Tailwind scale，不硬编码颜色（AGENTS.md 前端样式规范）。

### 4.3 测试

- **`useSettingsForm` hook 测试**（参考现有 settings-store.test.ts 的 createApi 工厂模式）：
  - 初始化读取 `settings.models.text.temperature` 回显
  - `setTemperature(0.3)` → save payload 的 text group 带 `temperature: 0.3`
  - `resetTemperature()` → save payload 带 `temperature: undefined`
  - image group 永不带 temperature
- **`AdvancedSettings` 组件测试**（`@testing-library/react` + `vitest`）：
  - 默认折叠（高级区内容不在 DOM）
  - 展开后输入合法值 blur → 回调 `setTemperature` 收到数值
  - 输入非法/空 blur → 回调收到 `undefined`
  - 「恢复默认」按钮 → 调用 `resetTemperature`
  - i18n 文案随 t() 渲染

### 4.4 验证

```bash
npm run lint --workspace=packages/app
npm test --workspace=packages/app
npm run build --workspace=packages/app
```

---

## Task 5 — 文档同步

**目标**：更新官方文档与 backlog。

**前置**：Task 1–4 全部完成。

### 5.1 改动文件

| 文件 | 改动 |
|------|------|
| `docs/official/architecture.md` §「默认模型切换」(`:55`) | 补充 temperature 传播链路：`SessionRuntime.setTemperature` → `getChatStreamFn` 注入；明确「仅文本路径、unset=provider 默认、仅对新会话生效」 |
| `docs/dev/backlog.md` | 标记 `[x] settings 文本模型支持全局 temperature 调节`；新增 `[ ] 文本模型高级设置支持 top_p（需先确认 pi-ai 各 provider top_p 覆盖与注入方式）` |

### 5.2 验证

人工核对 architecture.md 描述与实现一致；backlog 条目格式与现有条目一致。

---

## 整体验证（全部 Task 完成后）

```bash
npm run build           # 全链路编译（core → server → app）
npm run lint            # 全仓库 lint
npm run verify          # lint + build + unit tests + i18n check
```

可选 E2E（改动涉及设置弹窗 + IPC + store）：按 AGENTS.md「E2E 验证选择」，设置页改动优先跑相关 spec，合并前跑 `npm run verify:e2e`。

## 风险点

1. **merge/mask 透传遗漏**（Task 2）：若忘记透传 temperature，renderer 回显空、跨次保存丢值。实现后必须验证保存→重读回显一致。
2. **IPC 无条件传播**（Task 2）：`updateTemperature` 必须无条件调用（undefined 合法），不能照抄 `updateDefaultModel` 的 `if (defaultModel)` 守卫。
3. **registry 构造签名变更**（Task 2）：`constructor(logger, defaultModel?)` → options 袋，唯一调用方 `packages/server/src/index.ts:57` 必须同步，否则编译失败。
4. **onBlur 保存脏值**（Task 4）：组件内必须暂存输入脏值，blur 才提交；否则每次按键触发 IPC + 频繁落盘。
5. **i18n 三语言同步**（Task 3）：`npm run check:i18n` 校验 key 完整性，缺一个 key 则 `t()` 回退显示 key 本身。
6. **不引入 commit**：全部 Task 完成后不要自动 commit，等待用户明确要求。
