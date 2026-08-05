# OpenAI 图片生成 Provider — 执行计划

日期：2026-08-06
关联设计：`./design.md`

## 任务拆分

### T1 — 新增 `packages/core/src/model-providers/openai-images.ts`
镜像 `zhipu-images.ts`：
- `OpenaiImagesApi = "openai-images"`
- `OpenaiImagesModelRecord`、`OPENAI_IMAGE_MODELS`（gpt-image-2 / gpt-image-1.5 / gpt-image-1 / gpt-image-1-mini / dall-e-3）
- `resolveOpenaiImageModel(modelId)`
- `generateImagesOpenai(model, context, options)`：POST `{baseUrl}/images/generations`，Bearer；body `{model, prompt, n:1, size?, quality?}`；dall-e-3 加 `response_format:"b64_json"`，GPT 系列不加；归一化 b64_json / url fallback；错误/abort/缺 key 分支
- `createOpenaiImagesProvider()`：`createImagesProvider` + `envApiKeyAuth("...", ["SPHERSE_IMAGE_API_KEY"])`，baseUrl `https://api.openai.com/v1`
- 本地扩展类型 `OpenaiImagesOptions = ProviderImagesOptions & { size?; quality? }`

### T2 — 注册到 `packages/core/src/model-providers/index.ts`
- import `createOpenaiImagesProvider`
- `imagesModels.setProvider(createOpenaiImagesProvider())`
- `IMAGE_PROVIDER_DISPLAY_NAMES.openai = "OpenAI"`
- `IMAGE_PROVIDER_ENV_KEYS.openai = ["SPHERSE_IMAGE_API_KEY"]`

### T3 — `packages/core/src/tools/generate-image.ts` 暴露 size/quality
- `GenerateImageParams` 加可选 `size` / `quality`（Type.String + 中文 description）
- 本地类型 `ImageGenOptions = ProviderImagesOptions & { size?; quality? }`
- `execute` 把 `params.size` / `params.quality` 透传进 generateImages options

### T4 — 智谱 provider 支持 size
- `generateImagesZhipu` 读 `options.size`，非空则加入 body；本地扩展类型 `ZhipuImagesOptions`

### T5 — 测试
- 新增 `__tests__/openai-images.test.ts`（镜像 zhipu-images.test.ts + dall-e-3 response_format 分支 + size/quality 进 body 断言）
- 更新 `__tests__/tools/generate-image.test.ts`：size/quality 透传断言
- 更新 `__tests__/zhipu-images.test.ts`：size 进 body 断言

### T6 — 文档同步
- `docs/official/project-structure.md`：加 `openai-images.ts` 条目
- `docs/official/data-conventions.md`：generate_image 补 size/quality + OpenAI provider
- `docs/dev/backlog.md`：新增并标记完成

### T7 — 验证
- `npm run lint`
- `npm test --workspace=packages/core`

## 依赖顺序
T1 → T2 → T3/T4（并行） → T5 → T6 → T7
