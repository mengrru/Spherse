# 文本模型高级设置支持 top_p

## 背景

`2026-06-28-model-temperature` 已实现全局 temperature 调节，当时显式将 top_p 延后：

> pi-ai 的 `StreamOptions` 原生支持 `temperature?: number`，但没有类型化的 `topP` 字段（top_p 跨 provider 支持不均，需 `onPayload` 改写原始 payload，代价高且行为不可预期）。

backlog 条目：`文本模型 top_p 支持：高级设置支持 top_p 采样参数（需先确认 pi-ai 各 provider top_p 覆盖与注入方式）`。

本次完成该 backlog：确认覆盖面、确定注入方式，并将 temperature + top_p 统一收进 `SamplingParams` struct 贯穿全链路。

## 现状调研结论

### 1. pi-ai 没有 typed `topP`

`@earendil-works/pi-ai/dist/types.d.ts:44-120` 的 `StreamOptions` 只有 `temperature?: number`，无 `topP`。

### 2. `buildBaseOptions` 是 allowlist，会丢弃未知 key

`@earendil-works/pi-ai/dist/api/simple-options.js:1-20`（`streamSimple` 归一化选项）显式列出转发字段（temperature、maxTokens、signal、onPayload …）。**未列出的 key（如直接传 `topP`/`top_p`）会被丢弃，不会到达 provider**。所以不能靠「多传一个 option key」注入 top_p。

### 3. `onPayload` 是唯一注入点，且被各 API 在发送前调用

`StreamOptions.onPayload?: (payload, model) => payload | undefined`。各 API 实现在构造完 payload、发请求前调用：
- `openai-completions.js:106`
- `openai-responses.js:98`
- `anthropic-messages.js:344`
- `google-generative-ai.js:37`

返回新对象替换 payload，返回 `undefined` 保持不变。`onPayload` 本身也被 `buildBaseOptions` 转发（`:11`）。

### 4. 启用的 provider 只落到 4 种 api，且都支持 top_p

| provider | `model.api` | top_p 注入位置 |
|----------|-------------|----------------|
| openai | `openai-responses` | payload 根 `top_p` |
| anthropic、minimax | `anthropic-messages` | payload 根 `top_p` |
| deepseek、zai、xiaomi、moonshotai、xai | `openai-completions` | payload 根 `top_p` |
| google | `google-generative-ai` | `payload.config.topP`（@google/genai 用 camelCase） |

`onPayload` 收到 `(payload, model)`，`model.api` 标明 API，可按此分支。覆盖确认：**9 个启用 provider 全部支持 top_p**，不存在「静默不生效」的 provider。

## 设计决策

### 注入策略：`getChatStreamFn` 内按 `model.api` 分支的 `onPayload`

`getChatStreamFn(sampling?: SamplingParams)` 按 sampling 内各字段分发注入：
- `temperature` 是 pi-ai typed `StreamOptions` 字段，直接注入 options。
- `topP` 因 pi-ai 无 typed 字段，用 `onPayload` 注入（pi-ai 的官方扩展点，且能拿到 `model` 做分支）。

```ts
const { temperature, topP } = sampling ?? {};
return (model, context, options) =>
  models.streamSimple(model, context, {
    ...options,
    ...(temperature != null ? { temperature } : {}),
    ...(topP != null ? { onPayload: injectTopP(topP) } : {}),
  });
```

`injectTopP(topP)` 返回：

```ts
(payload, model) => {
  const api = model?.api;
  if (api === "google-generative-ai") {
    return { ...payload, config: { ...(payload?.config ?? {}), topP } };
  }
  if (
    api === "openai-completions" ||
    api === "openai-responses" ||
    api === "anthropic-messages"
  ) {
    return { ...payload, top_p: topP };
  }
  return undefined; // 未知 api：不注入，安全默认
};
```

**风险评估**：payload 形状是 pi-ai 内部约定，升级时可能变。缓解：只对 4 个已知 api 显式处理，未知 api no-op；onPayload 是官方扩展点，比 hack SDK 内部更稳。可接受。

**与现有 onPayload 共存**：当前 `getChatStreamFn` 不设 onPayload，调用方也未透传 onPayload，无冲突。

### top_p 范围与解析

- 范围 `0–1`（temperature 是 `0–2`），`step=0.1`。
- 新增 `parse-top-p.ts`（与 `parse-temperature.ts` 同构），验证 `0 ≤ n ≤ 1`，越界/空 → `undefined`。

### 全链路 plumbing：统一 SamplingParams

采样参数统一收进单一 `SamplingParams` struct 贯穿全链路（而非逐参数逐层穿透）。加新采样参数（如 future topK、frequencyPenalty）只需：① `SamplingParams` 加字段 → ② `getChatStreamFn` 注入逻辑加分支 → ③ `AdvancedSettings` 加一个 ParamField config → ④ i18n。

| 层 | 文件 | 改动 |
|----|------|------|
| 类型 | `core/src/types.ts` | 新增 `SamplingParams { temperature?: number; topP?: number }`；`ModelGroupSettings.sampling?: SamplingParams` |
| session 上下文 | `core/src/session/types.ts` | `SessionContext.sampling?: SamplingParams` |
| 工厂 | `core/src/factory.ts` | options + ctx 透传 `sampling` |
| session manager | `core/src/session/session-manager.ts` | 单一 `setSampling(sampling)` 取代 setTemperature/setTopP |
| live session | `core/src/session/live-session.ts` | 单一 `applySampling(sampling)`；`buildAgent` 用 `getChatStreamFn(ctx.sampling)` |
| 注入 | `core/src/model-providers/index.ts` | `getChatStreamFn(sampling?)` + `injectTopP`（topP 仍走 onPayload，是唯一需特殊注入的参数） |
| server 入口 | `server/src/index.ts` | options 透传 `sampling` |
| registry | `server/src/registry.ts` | 单一 `sampling` 字段 + `setSampling()` 取代 setTemperature/setTopP |
| 持久化 | `app/electron/settings.ts` | `maskModelGroup`/`mergeModelGroup` 透传 `sampling`（旧 flat `temperature` 字段不再读取——pre-release 迁移风险低） |
| 启动读取 | `app/electron/server.ts` | `ensureServer` 读 `sampling`；单一 `updateSampling()` |
| IPC | `app/electron/ipc/settings.ts` | `save-settings` 时调 `updateSampling()` |
| 表单 | `app/features/settings/use-settings-form.ts` | `GroupData.sampling`；单一 `patchSampling(params)`（内部 `mergeSampling` 做 partial merge） |
| UI | `app/features/settings/AdvancedSettings.tsx` | props 收敛为 `sampling` + `onSetSampling`；通用 `ParamField` 组件渲染每个参数（label + tooltip hint + input + reset），reset 通过 `onSet(undefined)` |
| 解析 | `app/features/settings/parse-top-p.ts` | 新文件（0–1 校验） |
| 装配 | `app/features/settings/index.tsx` | 传 `sampling`/`onSetSampling` |
| i18n | `i18n/src/locales/{zh-CN,en,zh-TW}.ts` | + `topP`/`topPPlaceholder`/`topPHint`/`topPReset`（温度文案沿用 temperature 键） |

### 测试

- `core`：`getChatStreamFn` 注入 top_p（各 api payload 形状）、`session-manager` 的 `setSampling` 传播（temperature + topP 共存）。
- `app`：`parse-top-p.test.ts`、`AdvancedSettings.structure.test.ts`（sampling-based API + tooltip hint + i18n key）、`use-settings-form.structure.test.ts`（patchSampling wiring）。
- `server`：registry `setSampling` 传播。

## 不在本次范围

- 不改 pi-ai 上游（不提 PR），用 `onPayload` 注入。
- top_p 不做 per-agent / per-session 粒度，仍是全局设置（与 temperature 一致）。
- image 模型不支持 top_p。
