# Seedream 图片 Provider 接入（火山方舟直连）

日期：2026-10-21

## 背景

图片生成目前支持三个 provider：openrouter（pi-ai 内置目录，含 seedream 系列但走 OpenRouter 转售渠道）、zhipu（智谱直连）、openai。用户希望直连火山方舟（Volcano Ark）使用 Seedream 系列模型：国内 endpoint、Ark API Key 计费、无需 OpenRouter 中转。

## 调研结论

### 现有架构（代码为准）

- image provider 完全构建在 pi-ai 1.3.0 的 `MutableModels` 上：`ModelCatalog` 构造时 `setProvider()` 装配（`packages/core/src/model-providers/catalog.ts:203-210`）
- provider 实现 = 静态模型常量 + `generateImages`（永不 throw，错误归一化为 `AssistantImages.stopReason === "error"`）+ `createProvider({ images: { "<api>": { generateImages } } })`，模板见 `zhipu-images.ts`
- 设置 UI / server 路由 / contracts schema / 凭据存储（`models.image.providers.<id>.apiKey`）全部按 provider id 数据驱动，**零改动**
- 激活 provider 的 key 经 `applyModelSettingsToEnv` 注入 `SPHERSE_IMAGE_API_KEY`，`generate_image` tool 按 `SPHERSE_IMAGE_MODEL` 前缀分派（`packages/core/src/tools/generate-image.ts:55-66`）
- env key 单槽约束：`SPHERSE_IMAGE_API_KEY` 为全 image provider 共享的单一槽位，仅 `defaultModel` 前缀所属 provider 的 key 进 env，切换默认图片模型即覆盖——"凭据存储零改动"成立的前提

### Seedream 官方 API（火山方舟 CN 渠道，来源见文末）

- Endpoint：`POST https://ark.cn-beijing.volces.com/api/v3/images/generations`，同步返回
- 鉴权：`Authorization: Bearer $ARK_API_KEY`
- 请求体：`model`、`prompt`（必选）；`size`（档位 `"1K"/"2K"/"4K"` 或显式 `"2048x1024"`）、`response_format`（`url` 默认 / `b64_json`）、`watermark`（默认 true）、`output_format`（仅 5.0 系列）可选。**无 `seed` / `guidance_scale` 参数**（已全文检索官方 API 参考确认）
- 响应体：`{ model, created, data: [{ url | b64_json, size, output_format? }], usage }`；`data` 项可能带 `error{code,message}`（组图单项失败）
- 错误：HTTP 状态码 + body `error{code, message}`；401 AuthenticationError、404 InvalidEndpointOrModel.NotFound、429 限流等
- 图片 URL 有效期 24 小时 → 请求 `response_format: "b64_json"`，tool 端立即写盘，规避 URL 过期
- 模型（CN Model ID，截至 2026-10）：

| 模型 | Model ID | size 档位 |
|---|---|---|
| Seedream 5.0 Pro | `doubao-seedream-5-0-pro-260628` | 1K/1.5K/2K |
| Seedream 5.0 Flash | `doubao-seedream-5-0-flash-260915` | 1K/1.5K/2K |
| Seedream 5.0 Lite | `doubao-seedream-5-0-260128` | 2K/3K/4K |
| Seedream 4.5 | `doubao-seedream-4-5-251128` | 2K/4K |
| Seedream 4.0 | `doubao-seedream-4-0-250828` | 1K/2K/4K |

## 方案

新建 `packages/core/src/model-providers/seedream-images.ts`，完整复刻 zhipu-images 模式：

1. `SEEDREAM_IMAGE_MODELS`：上表 5 个模型，`provider: "seedream"`、`api: "seedream-images"`、`baseUrl: "https://ark.cn-beijing.volces.com/api/v3"`、`input: ["text"]`、`output: ["image"]`
2. `generateImagesSeedream(model, context, options)`：
   - 请求体 `{ model, prompt, response_format: "b64_json" }`，`size` 经 `normalizeSeedreamSize` 归一化后透传（档位与显式像素格式均为 string，直接透传；`auto`（含大小写/空白变体）归一化为省略，走服务端默认——官方 API 参考 2026-10-21 核验：文生图场景 `auto` 对全部模型为非法值，仅图层拆分场景合法（不在本次范围）；省略 `size` 对全部 5 个模型有效，各模型有文档化默认值：pro/flash 默认 `2K`，lite/4.5/4.0 默认 `2048x2048`）；`quality` 忽略（Seedream 无此参数，与 zhipu 行为一致）
   - `watermark` 不传，用服务端默认（manager 决策：保留默认 true，不加关闭范围）
   - mimeType：`item.output_format` 存在时映射（`image/jpeg` / `image/png` / `image/webp`），否则默认 `image/jpeg`（Seedream 全系默认输出 jpeg）；兼容 `url` 响应分支（下载转 base64，同 zhipu）
   - `data` 项带 `error` 字段时归一化为 error 返回（message 缺失时回退 code）
   - 错误处理同 zhipu：`!res.ok` 解析 `error.message` 回退 `` `Seedream API error: ${status}` ``，catch 区分 abort/error，永不 throw
3. `createSeedreamImagesProvider()`：`auth: envApiKeyAuth("Seedream API key", ["SPHERSE_IMAGE_API_KEY"])`

`catalog.ts` 三处注册：

- `IMAGE_PROVIDER_DISPLAY_NAMES` 加 `seedream: "Seedream"`（专有名词，与 OpenAI/OpenRouter 一致不进 i18n）
- `IMAGE_PROVIDER_ENV_KEYS` 加 `seedream: ["SPHERSE_IMAGE_API_KEY"]`
- 构造函数 `this.models.setProvider(createSeedreamImagesProvider())`

## 非目标（本次不做）

- BytePlus 海外渠道（endpoint/模型 ID 前缀不同：`dola-seedream-*` / `seedream-*`）
- 图片编辑/垫图（`image` 参数）、多图组图（`sequential_image_generation`）、图层拆分、联网搜索、流式 SSE —— 现有 `generate_image` tool 仅支持 prompt/size/quality，扩展输入面超出"复用现有图片能力边界"
- `output_format`/`watermark`/`optimize_prompt_options` 等高级参数透传

## 影响面

| 包 | 改动 |
|---|---|
| core | 新增 `seedream-images.ts` + 测试；`catalog.ts` 三处注册 |
| server / app / contracts / i18n / desktop / web | 零改动（数据驱动） |
| docs | 本 design doc；`docs/official/project-structure.md` 同步 core `model-providers/` 文件列表 |

行数预算：`seedream-images.ts` 5 个模型记录较 zhipu（187 行）多约 44 行，预计 ~230 行，满足非配置 TS ≤350 硬约束。

## 测试计划

- `packages/core/src/__tests__/seedream-images.test.ts`：模型常量 shape、resolve、`normalizeSeedreamSize` 单测（auto 变体/空值/档位与显式像素透传）、provider 工厂
- `packages/core/src/__tests__/seedream-images-generation.test.ts`：`generateImagesSeedream` 行为——b64/url 归一化（含 output_format mime 映射）、非 200（含 401 error.message 提取）、单项 error、无 data、无 key、网络错误/AbortError、pre-abort、size 透传（档位/显式像素）/缺省/auto 归一化回归
- `model-providers-catalog.test.ts` 补 `getImageSupportedProviders` 接线断言：含 `seedream`、5 个模型、display name 与 envKeys 正确（防 `setProvider` 漏注册静默缺失）
- `generate-image.test.ts` 现有覆盖已按 provider id 数据驱动分派，无需新增
- 无真实 Ark key，真实调用未测（mock 验证，mock 无法证明外部 API 真实性）；模型 ID 与参数断言的官方来源与抓取日期见文末，真实性待有真实 key 后 smoke 验证

## 工具默认 size 兼容性核查（2026-10-21，官方 API 参考）

`generate_image` tool 的 `size` 为可选参数、无内置默认值：不传 → provider 省略 `size` → 对全部 5 个 Seedream 模型有效（文档化默认）。tool 描述中的示例值核查：

- `"auto"`：对全部 5 个模型必然非法（仅图层拆分场景合法）→ **已修复**：provider 层归一化为省略
- `"1024x1024"` / `"1536x1024"` / `"1024x1536"`：pro/flash/4.0 的总像素下限为 921,600 px，`1024x1024`（1,048,576 px）等示例高于下限故有效；lite/4.5 总像素下限 3,686,400 px，上述示例均低于下限故非法——非"必然无效"，属模型相关约束；超范围时 Ark 返回描述性 400（含有效区间说明），已归一化为错误卡片展示，与 zhipu/openai 传非法 size 的失败模式一致。按"最小适配"原则不做按模型的像素区间校验（需 per-model 范围表，超本次范围）

## 开放项（不阻塞）

- `watermark` 保持服务端默认 true（manager 已决策：不加关闭范围）
- 显式像素 size 超出模型总像素区间时依赖 Ark 400 错误反馈（见上节核查）
- 模型列表为静态常量，新版本模型需随代码更新

## 来源

以下官方文档均于 **2026-10-21** 抓取核验（`.md` 原文端点）：

- API 参考（endpoint/鉴权/请求响应参数/`size` 各模型默认值与取值范围/`auto` 合法性）：https://ark.volcengine.com/region:cn-beijing/docs/image-generation-api （www.volcengine.com/docs/82379/1330310）
- 教程「模型能力」对比表（**5 个 CN Model ID 的权威来源**，含 `doubao-seedream-5-0-260128` 别名 `doubao-seedream-5-0-lite-260128`）：https://ark.volcengine.com/region:cn-beijing/docs/seedream-4-0-5-0 （82379/1541523）
- 鉴权：https://ark.volcengine.com/region:cn-beijing/docs/base-url-and-authentication （82379/1263279）
- 错误码：https://ark.volcengine.com/region:cn-beijing/docs/error-codes
