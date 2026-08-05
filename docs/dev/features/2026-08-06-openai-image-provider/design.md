# OpenAI 图片生成 Provider

日期：2026-08-06

## 背景

图片生成支持（v1，`2026-06-20-image-generation-support`）已接入两个 provider：OpenRouter（pi-ai 内置）和智谱（自建 `zhipu-images.ts`）。agent 通过 `generate_image` 工具按 prompt 生成图片并以 image card 展示。

用户希望新增 **OpenAI 官方** 图像生成 provider，直接调用 OpenAI 的 `/v1/images/generations`，使用 OpenAI 自有 API Key（而非经 OpenRouter 中转）。同时把 `size` / `quality` 参数暴露给 LLM，让 agent 能按需控制出图尺寸与质量。

## 现状分析

现有 image provider 架构（`packages/core/src/model-providers/index.ts`）：

- 维护 `imagesModels: MutableImagesModels` 单例（pi-ai `builtinImagesModels()`），模块加载时 `imagesModels.setProvider(createZhipuImagesProvider())` 注入智谱。
- `getImageSupportedProviders(): ProviderCatalog` 遍历 `imagesModels.getProviders()` 序列化目录给 UI（`IMAGE_PROVIDER_DISPLAY_NAMES` / `IMAGE_PROVIDER_ENV_KEYS` 提供显示名与 env key）。
- 所有 image provider 共享同一 env 槽 `SPHERSE_IMAGE_API_KEY`。

设置注入链路（`packages/desktop/electron/settings.ts:129-138` `applySettingsToEnv`）**完全 provider 无关**：读取 `imageGroup.defaultModel`（形如 `openai/gpt-image-2`），按 `/` 切出 provider，从 `imageGroup.providers[provider].apiKey` 取 key，写入 `SPHERSE_IMAGE_MODEL` + `SPHERSE_IMAGE_API_KEY`。设置页下拉来自 `getImageProviders()` → `getImageSupportedProviders()`。

工具执行链路（`packages/core/src/tools/generate-image.ts`）也 **provider 无关**：从 env 读 model 串 → `imagesModels.getModel(provider, modelId)` → `imagesModels.generateImages(model, ctx, { apiKey, signal })`。

**结论**：新增 provider 不需要改动 server / 设置 UI / 设置存储，只需 (1) 新增 provider 模块，(2) 在 `index.ts` 注册并补 display name / env key 映射。

参考实现：`packages/core/src/model-providers/zhipu-images.ts`（`createImagesProvider` + `envApiKeyAuth` 工厂模式）。

## OpenAI API 调研（2026-08）

- 端点：`POST https://api.openai.com/v1/images/generations`，`Authorization: Bearer {apiKey}`，`Content-Type: application/json`。
- Body：`{ model, prompt, size?, quality?, n?, background?, output_format?, ... }`。
- 返回：`{ created, data: [{ b64_json? | url?, revised_prompt? }], usage?, ... }`。
  - **GPT image 系列**（`gpt-image-2` / `gpt-image-1.5` / `gpt-image-1` / `gpt-image-1-mini`）始终返回 `b64_json`，**不支持** `response_format` 参数。
  - **dall-e-3** 默认返回 `url`，可显式设 `response_format: "b64_json"`。
- `size`：
  - GPT image 系列：`auto` / `1024x1024` / `1536x1024` / `1024x1536`；`gpt-image-2` 还支持任意 `WIDTHxHEIGHT`（宽高均能被 16 整除，长宽比 1:3~3:1，最大 3840x2160）。
  - dall-e-3：`1024x1024` / `1792x1024` / `1024x1792`。
- `quality`：
  - GPT image 系列：`auto`（默认）/ `low` / `medium` / `high`。
  - dall-e-3：`standard` / `hd`。
- 模型族（截至 2026-08）：`gpt-image-2`（旗舰，含 dated 别名 `gpt-image-2-2026-04-21`）、`gpt-image-1.5`、`gpt-image-1`、`gpt-image-1-mini`、`dall-e-3`、`dall-e-2`。

## 目标

1. 新增 OpenAI image provider，agent 可在设置中选 `openai/*` 模型生成图片。
2. `generate_image` 工具新增可选 `size` / `quality` 参数，暴露给 LLM，按 provider 能力透传。
3. provider 注册后设置页下拉自动出现 OpenAI 选项（无需 UI 改动）。

## 非目标

- 不做 img2img / 图片编辑（`/v1/images/edits`）。
- 不做流式生成（`stream`）。
- 不做多图返回（`n` 固定为 1）。
- 不做 provider 端 size 合法性校验——交由 OpenAI 服务端校验，错误经 `stopReason: "error"` 回传。
- 不改变共享 `SPHERSE_IMAGE_API_KEY` 单槽设计（沿用现有 openrouter / zhipu 约束：同一时刻仅一个 image provider 生效）。

## 设计方案

### 1. 新增模块 `packages/core/src/model-providers/openai-images.ts`

镜像 `zhipu-images.ts` 结构：

- `export type OpenaiImagesApi = "openai-images"`
- `export interface OpenaiImagesModelRecord { id; name; provider:"openai"; api:OpenaiImagesApi; baseUrl; input; output; cost }`
- `export const OPENAI_IMAGE_MODELS: Record<string, OpenaiImagesModelRecord>`，收录：
  - `gpt-image-2`（旗舰）
  - `gpt-image-1.5`
  - `gpt-image-1`
  - `gpt-image-1-mini`
  - `dall-e-3`
  
  （不含 `dall-e-2`——老旧且能力受限。）
- `export function resolveOpenaiImageModel(modelId): ImagesModel<OpenaiImagesApi>`（与 zhipu 同构，构造 `ImagesModel` 字面量）
- `export async function generateImagesOpenai(model, context, options?): Promise<AssistantImages>`：
  - 从 `context.input` 抽取 text prompt（与 zhipu 一致）。
  - 读 `options.apiKey` / `options.signal` / `options.size` / `options.quality`。
  - 缺 apiKey → `{ stopReason:"error", errorMessage:"No OpenAI api key provided" }`；signal 已 abort → `stopReason:"aborted"`。
  - 组装 body：`{ model, prompt, n:1 }`；`size` 非空则加入；`quality` 非空则加入。
  - **`response_format` 策略**：`dall-e-3` 设 `"b64_json"`；GPT image 系列不发送（API 不支持）。
  - `POST {baseUrl}/images/generations`，Bearer 鉴权。
  - 归一化响应：优先取 `data[].b64_json`；否则按 `data[].url` fetch 回来转 base64（dall-e-3 fallback，mimeType 从 content-type 或 url 后缀推断）；无可用图 → `stopReason:"error"`。
  - 错误体读 `error.message`，非 200 → `stopReason:"error"`；网络异常 / abort → 对应 stopReason。
- `export function createOpenaiImagesProvider(): ImagesProvider`：
  - `createImagesProvider({ id:"openai", name:"OpenAI", auth:{ apiKey: envApiKeyAuth("OpenAI image API key", ["SPHERSE_IMAGE_API_KEY"]) }, models:[...], api:{ generateImages: generateImagesOpenai as any } })`
  - `baseUrl`：`https://api.openai.com/v1`。

> 注：`api.generateImages` 处沿用 zhipu 的 `as any` 边界强转（pi-ai 开放联合类型），与现有风格一致。

### 2. 注册到 `index.ts`

- import `createOpenaiImagesProvider`。
- 在 `imagesModels.setProvider(createZhipuImagesProvider())` 之后追加 `imagesModels.setProvider(createOpenaiImagesProvider())`。
- `IMAGE_PROVIDER_DISPLAY_NAMES` 加 `openai: "OpenAI"`。
- `IMAGE_PROVIDER_ENV_KEYS` 加 `openai: ["SPHERSE_IMAGE_API_KEY"]`（沿用共享槽）。

注册后 `getImageSupportedProviders()` 自动把 OpenAI 及其 5 个模型纳入目录，设置页下拉自动出现。

### 3. `generate_image` 工具暴露 `size` / `quality`

`packages/core/src/tools/generate-image.ts`：

- 参数 schema `GenerateImageParams` 增加两个可选字段：
  - `size: Type.Optional(Type.String({ description: "图片尺寸，如 \"1024x1024\"、\"1536x1024\"、\"auto\"。不同模型支持不同，留空用模型默认。" }))`
  - `quality: Type.Optional(Type.String({ description: "图片质量：\"low\" | \"medium\" | \"high\" | \"auto\"（GPT image 系列）；dall-e-3 用 \"standard\" | \"hd\"。留空用模型默认。" }))`
- `execute` 内把 `params.size` / `params.quality` 透传进 `generateImages` 的 options：
  ```ts
  result = await imagesModels.generateImages(
    model,
    { input: [{ type: "text", text: prompt }] },
    { apiKey: config.apiKey, ...(signal ? { signal } : {}), ...(params.size ? { size: params.size } : {}), ...(params.quality ? { quality: params.quality } : {}) },
  );
  ```
- 各 provider 在 `options` 上读取这两个可选字段（OpenAI、智谱读取；OpenRouter builtin 忽略未知字段，行为安全）。

**类型处理**：`ProviderImagesOptions`（pi-ai 外部类型）不含 `size`/`quality`。不在全局做 declaration merging（pi-ai 类型非我们所有，避免升级耦合），而是在 provider 实现内部用本地接口断言读取，例如：

```ts
type OpenaiImagesOptions = ProviderImagesOptions & { size?: string; quality?: string };
// generateImagesOpenai 签名用 OpenaiImagesOptions
```

工具侧构造 options 时为普通对象字面量，TS 结构兼容即可通过；调用 `imagesModels.generateImages` 时该 options 形参为 pi-ai 的 `ProviderImagesOptions`，多余字段在运行时无害，类型上对象字面量多余属性会被推断为 error——故在工具侧用一个本地扩展类型 `ImageGenOptions = ProviderImagesOptions & { size?: string; quality?: string }` 声明变量再传入，避免字面量超额属性报错。

### 4. 智谱 provider 同步支持 size（小增强）

`generateImagesZhipu` 当前 body 为 `{ model, prompt, response_format }`。增读 `options.size`，非空则加入 body（智谱 BigModel `/images/generations` 支持 `size`）。让 `size` 参数对智谱也生效，保证「工具暴露 size」对所有自建 provider 一致可用。`quality` 智谱不支持，忽略。

## 数据流（无变化，列此以示完整）

```
设置页选 openai/gpt-image-2 + 填 apiKey
  → save-settings IPC → saveSettings() → applySettingsToEnv()
      → process.env.SPHERSE_IMAGE_MODEL = "openai/gpt-image-2"
      → process.env.SPHERSE_IMAGE_API_KEY = <openai key>
  → agent 调 generate_image(prompt, size?, quality?)
      → readImageConfig() 从 env 解析 provider="openai", modelId="gpt-image-2", apiKey
      → imagesModels.getModel("openai","gpt-image-2")  ← 命中注册的 OpenAI provider
      → imagesModels.generateImages(model, ctx, { apiKey, signal, size, quality })
      → generateImagesOpenai() POST OpenAI → b64_json → 写盘 → image card
```

## 测试

新增 `packages/core/src/__tests__/openai-images.test.ts`（镜像 `zhipu-images.test.ts`）：

- `OPENAI_IMAGE_MODELS`：5 个模型 shape 正确（id / provider="openai" / api="openai-images" / output 含 "image"）。
- `resolveOpenaiImageModel`：已知模型返回正确字面量；未知模型抛错。
- `generateImagesOpenai`：
  - b64_json 响应归一化为 `ImageContent`；校验请求 URL 含 `/images/generations`、body.model/prompt/size/quality 正确、`Authorization: Bearer`。
  - dall-e-3 分支：请求 body 含 `response_format:"b64_json"`；GPT image 分支不含。
  - url 响应 fallback：fetch 回来转 base64 + mimeType 推断。
  - 非 200 → `stopReason:"error"` + errorMessage。
  - 响应无 data / 无可用图 → `stopReason:"error"`。
  - 缺 apiKey → `stopReason:"error"`。
  - signal 已 abort → `stopReason:"aborted"`。
- `createOpenaiImagesProvider`：id="openai"、name="OpenAI"、`generateImages` 为函数、`getModels()` 非空。

更新 `packages/core/src/__tests__/tools/generate-image.test.ts`：新增用例验证 `size` / `quality` 被透传进 `generateImages` 的 options（mock `imagesModels.generateImages`，断言 options.size / options.quality）。

更新 `packages/core/src/__tests__/zhipu-images.test.ts`：补一个用例验证 `options.size` 被写进请求 body。

## 文档同步（AGENTS.md 要求）

- `docs/official/project-structure.md`：`model-providers/` 目录加 `openai-images.ts` 条目。
- `docs/official/data-conventions.md`：`generate_image` 工具说明补 size/quality 参数与 OpenAI provider。
- `docs/dev/backlog.md`：新增条目并标记完成。

## 风险与约束

- **共享 env 单槽**：OpenAI 与 openrouter / zhipu 共用 `SPHERSE_IMAGE_API_KEY`，切换 provider 时旧 key 会被覆盖（既有约束，本次不解决）。
- **pi-ai 类型边界**：`options` 携带 `size`/`quality` 依赖本地扩展类型断言；pi-ai builtin provider 忽略多余字段，运行时安全。
- **OpenAI 模型清单时效**：`gpt-image-2` 等为 2026-08 时点清单，后续 OpenAI 增删模型需手动同步 `OPENAI_IMAGE_MODELS`。
