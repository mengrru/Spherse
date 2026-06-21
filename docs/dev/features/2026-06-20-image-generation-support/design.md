# 图片生成支持（v1）

日期：2026-06-20

## 背景

Spherse 目前只能由 agent 产出文本与 HTML card。世界观创作中常常需要配图（场景插画、角色立绘、地图、道具图标等），当前需要用户切到外部工具生成再手动导入。

目标依赖 `@earendil-works/pi-ai@0.78.0` 已经内置了图片生成能力，但项目尚未接入。本 feature 让 agent 在对话中能够按需生成图片，并在聊天中以 image card 展示，可一键导出到项目文件。

## pi-ai 能力调研结论

pi-ai v0.78.0 提供与聊天流式 API 独立的图片生成 API：

- `generateImages(model, context, options?) => Promise<AssistantImages>`（`dist/images.d.ts`）
- 模型发现：`getImageProviders()` / `getImageModels(provider)` / `getImageModel(provider, modelId)`
- 内置仅 `openrouter` 一个图片 provider，共 29 个模型（flux、gemini-image、gpt-5-image、recraft-v4、seedream 等），`api: "openrouter-images"`
- 图片内容块类型：`ImageContent = { type: "image"; data: string(base64); mimeType: string }`，已内置于 `UserMessage` / `ToolResultMessage` / `ImagesContext`
- 关键限制（README 明确）：**图片模型是一次性 API，不参与 agent 的 tool-calling 循环**；要分析图片仍需用 vision 模型的 `stream()`/`complete()`

项目当前只 import 了 `streamSimple`（聊天）和 `getProviders`/`getModels`/`getModel`（目录），未使用图片 API；`openrouter` 也未在 `packages/core/src/model-providers.ts` 的 `ENABLED_PROVIDERS` 中。

**pi-ai 扩展机制分两层（已读源码确认）：**
1. **provider 实现**（`images-api-registry.js`）：`registerImagesApiProvider({api, generateImages})` 注册「如何调用某 provider 的 HTTP」，由 `generateImages()` 经 `model.api` 派发（`images.js:10-13`）。**完全可扩展。**
2. **模型目录**（`image-models.js`）：从生成的 `IMAGE_MODELS` 常量装载的只读 `Map`，`getImageProviders`/`getImageModels`/`getImageModel` 全部只读，**无 `registerImageModel`**。无法把自定义模型加入目录。

**关键洞察**：`generateImages(model, ...)` 只消费传入的 `model` 对象本身（`openrouter.js:4-65` 只读 `model.api/provider/id/baseUrl/headers/cost/output`），**不查目录**。因此对智谱，我们可自行构造 `ImagesModel` 字面量直接喂给 `generateImages`，不必进目录。

**接入策略**：最大化复用 pi-ai。执行链路完全走 pi-ai（注册智谱 provider 实现 + 自建 `ImagesModel` 字面量 + 调 `generateImages`）。仅因为「目录不可扩展」需要在设置页下拉里**并列展示**智谱的少量模型——这部分用一个小模块承载，不做聚合包装（不重新导出 OpenRouter 目录，消费者对 OpenRouter 直接调 pi-ai）。

## 目标

1. agent 可在对话中自主决定调用 `generate_image` 工具，按 prompt 生成单张图片
2. 生成的图片在聊天中以 image card 展示，并带「生成中」占位符
3. image card 右上角有「导出到文件」按钮
4. 图片生成模型与 API Key 在全局设置中配置

## 非目标（v1 不做）

- img2img / 参考图输入 / 图片编辑 / 重生
- 多图返回、size/aspect/negative prompt 参数
- 图片输入到 agent（vision 分析）
- image card 的 `data-chat-*` 主题化属性（列为 follow-up，见末尾）
- 直发动作 / composer 触发按钮（仅 agent tool 触发）

## 调度策略

**仅作为 AgentTool 接入**。agent 在对话中根据上下文判断需要插图时调用 `generate_image` 工具；工具内部调用 pi-ai 的 `generateImages`（绕过 agent 的 tool-calling 循环，因为图片模型不支持 tool calling）。

这是与现有 `render_card` 一致的模式：agent 决策 → core tool 执行 → 通过 `details` 侧信道把富内容回传 → reducer 挂载到 `_card` → UI 渲染。

## 架构与数据流

```
user message
  → agent（聊天模型）决策调用 generate_image(prompt)
  → tool.execute():
      1. onUpdate({ details:{ type:"image", status:"generating", prompt } })   ← 立即回传占位符
      2. 从 process.env 读 imageConfig: provider = SPHERSE_IMAGE_PROVIDER, modelId = SPHERSE_IMAGE_MODEL, apiKey = SPHERSE_IMAGE_OPENROUTER_KEY|SPHERSE_IMAGE_ZHIPU_KEY
      3. model = provider==="openrouter" ? getImageModel("openrouter", modelId) : resolveZhipuImageModel(modelId)   ← 直接用 pi-ai；智谱走自建模型字面量
      4. AssistantImages = await generateImages(model, { input:[{type:"text",text:prompt}] }, { apiKey, signal })   ← 永远走 pi-ai
      5. 取 output 中的 ImageContent → Buffer.from(data,"base64")
      6. ext = mimeType→扩展名映射; name = `<yyyyMMddHHmmss-UTC>-<4hex>.<ext>`; destRel = `.spherse/generated-images/<name>`
      7. abs = resolveProjectPath(root, destRel); await fs.mkdir(dir,{recursive:true}); await fs.writeFile(abs,buf)
      8. onUpdate({ details:{ type:"image", status:"done", path:destRel, prompt, model, mimeType, ... } })  ← 回传最终图
      9. return { content:[{type:"text",text:`已生成图片：${prompt}`}], details:{...同上} }
  → AgentEvent(tool_execution_update ×2 / tool_execution_end)
  → WebSocket → chat-session-reducer
      toolName==="generate_image" && details.type==="image" → toolCall._card = details
  → MessageItem.tsx 按 _card.type 分发 → <ImageCardRenderer/>
      status:"generating" → 骨架屏/spinner
      status:"done"        → <img src={client.getPreviewUrl(path)}> + 右上角导出按钮
  → 用户点导出 → Electron showSaveDialog(defaultPath: projectRoot)
  → client.exportImage(srcRel, destAbs) → POST /api/projects/:id/images/export {src,dest}
  → server resolveProjectPath 双校验 + fs.copyFile(srcAbs, destAbs)
```

### 关键设计决策

**1. 写盘不需要 FileWriteMutex**
每次生成写一个基于 UTC 时间戳 + 4 位随机 hex 的唯一文件名（`.spherse/generated-images/<yyyyMMddHHmmss-UTC>-<4hex>.<ext>`），并发写永远不会命中同一路径（同秒碰撞概率 1/65536，可忽略；万一磁盘已存在同名文件，写盘前重试生成新 hex）。`FileWriteMutex` 的语义是序列化对**同一路径**的并发写（防止两个工具同时写 `chapter1.md` 互相覆盖）。对唯一路径的图片写，mutex 是纯开销，故不使用。目录创建用 `fs.mkdir({recursive:true})`（幂等，无需互斥）。

**2. 占位符通过 onUpdate 实现**
工具在 `execute` 入口立即 `onUpdate` 一个 `status:"generating"` 的 details，让前端在生成开始时就看到 card。这与 `render_card` 一致。注意：现有 reducer 的流式路径只从 `tool_execution_update`（而非 `tool_execution_end`）读 `_card`，因此工具必须在返回前再 `onUpdate` 一次最终 details，确保 live 路径下卡片从骨架屏正确切到图片。历史恢复路径则从持久化的 tool_result.details 读取。

**3. 二进制不进消息总线/SQLite**
图片字节直接由 core tool 写盘，`AgentEvent`/WebSocket/SQLite 只携带相对路径字符串，不携带 base64。避免 DB 膨胀和大 WS 帧。这是相对 `render_card`（HTML 内联在 details）的关键差异——因为 HTML 是文本、图片是二进制。

**4. 图片配置经环境变量注入（对齐 API key 模式，不进 core 运行时）**
图片配置存于 Electron `electron-store` 的 `AppSettings`（与 chat 的 `defaultModel`/API key 同处），但**注入方式与 API key 同构**——IPC save 时经 `applyImageSettingsToEnv()` 写入 `process.env`，core tool 直接读 env，不经 `ToolContext` getter。

理由：chat 的 `defaultModel` 注入 core 运行时（`SessionRuntime.globalDefaultModel`）是因为需要运行时做类型化解析（`resolveModelById` + 三级 fallback 链）。image tool **自己**做模型解析（`getImageModel`/`resolveZhipuImageModel`），不需要运行时参与，注入运行时纯属绕路。env 注入与现有 API key（`applySettingsToEnv` → `process.env[envKey]`，pi-ai 从 env 读）完全同构，是最小一致方案。

约定的 env 变量：
- `SPHERSE_IMAGE_PROVIDER`（`"openrouter" | "zhipu"`）
- `SPHERSE_IMAGE_MODEL`（model id，如 `google/gemini-2.5-flash-image` 或 `glm-image`）
- `SPHERSE_IMAGE_OPENROUTER_KEY` / `SPHERSE_IMAGE_ZHIPU_KEY`（按 provider 对应一个，两个 key 各自存 AppSettings，切换 provider 时保留各自 key）

「是否启用」隐式化：provider + model + 对应 key 三者都齐即视为启用，不单独存 enabled 字段。

**5. 最大化复用 pi-ai 扩展机制，不建发现聚合层**
pi-ai 的扩展能力足以覆盖执行链路，**不额外包装 OpenRouter 目录**：
- **OpenRouter**：core 直接调 pi-ai 的 `getImageProviders()` / `getImageModels("openrouter")` / `getImageModel("openrouter", id)`。不重新导出、不包装。
- **智谱（Zhipu）**：单独一个 `zhipu-images.ts` 小模块承载：
  - `registerZhipuImages()`：调用 pi-ai 的 `registerImagesApiProvider({ api: "zhipu-images", generateImages: generateImagesZhipu })` 注册 provider 实现；`generateImagesZhipu` 内部 POST `https://open.bigmodel.cn/api/paas/v4/images/generations`（Bearer 鉴权，body `{model, prompt, size}`），把响应归一化为 `AssistantImages`（`output: ImageContent[]`）。
  - `ZHIPU_IMAGE_MODELS`：本地常量，仅含 `glm-image`（{id, provider:"zhipu", api:"zhipu-images", output:["image"]}）。
  - `resolveZhipuImageModel(modelId)`：构造 `ImagesModel` 字面量返回（因目录不可注册，但 `generateImages` 不查目录，字面量可直接喂入）。
- **provider/model 列表的传递（遵循现有架构）**：renderer 不直接 import core/pi-ai，须经 server 三层（与现有 chat 目录 `getSupportedProviders` → `GET /api/settings/providers` → `api.getSupportedProviders()` 同构）。具体：
  - core 新增 `getImageSupportedProviders(): ImageProviderCatalog`（聚合 pi-ai OpenRouter 目录 + `ZHIPU_IMAGE_MODELS`，返回可序列化纯数据，shape 对齐新增的 `imageProviderCatalog` 契约）。注意：此函数职责仅为**序列化目录给 UI**，不是执行入口——tool 取模型仍分别走 `getImageModel`/`resolveZhipuImageModel`。
  - server `routes/images.ts` 新增 `GET /api/settings/image-providers`（无 projectId，全局），response schema 为新增的 `imageProviderCatalog`（图片模型无 reasoning/contextWindow 等字段，不复用 chat 的 `ProviderCatalogContract`，新增独立 schema）。
  - server `routes/images.ts` 新增 `POST /api/projects/:projectId/images/export`（binary copy，见导出端点）。
  - renderer `api.ts` 新增 `getImageProviders()`。
  - 契约 schema 统一定义在 `@spherse/server/contracts`（AGENTS.md 规范），server route、renderer client 必须复用同一 schema/parser。

这样只多出一个「智谱专用」模块，而非跨 provider 的聚合层；未来加新 provider 也是新增同级小模块，而非改中心化的发现层。chat 的 `ENABLED_PROVIDERS` 与图片完全无关。

## 组件

### 新增

| 层 | 文件 | 职责 |
|---|---|---|
| core | `src/tools/generate-image.ts` | `createGenerateImageTool(ctx)`：按 activeProvider 直接用 pi-ai（OpenRouter）或 `resolveZhipuImageModel`（智谱）取模型，调 pi-ai `generateImages`、写盘、回传 details |
| core | `src/zhipu-images.ts` | 智谱图片接入小模块：`registerZhipuImages()`（经 pi-ai `registerImagesApiProvider` 注册 `zhipu-images` provider + BigModel HTTP 实现）、`ZHIPU_IMAGE_MODELS` 常量（`glm-image`）、`resolveZhipuImageModel(modelId)`（构造 `ImagesModel` 字面量）。OpenRouter 不在此处，直接走 pi-ai |
| core | `src/model-providers.ts`（或同级新文件） | `getImageSupportedProviders()`：聚合 pi-ai OpenRouter 目录 + `ZHIPU_IMAGE_MODELS`，返回可序列化纯数据给 UI 下拉（与 `getSupportedProviders` 同构，仅供序列化，非执行入口） |
| server | `src/routes/images.ts` | `GET /api/settings/image-providers`（provider/model 目录，无 projectId，全局）、`POST /api/projects/:projectId/images/export`（binary copy）。契约 schema 新增 `imageProviderCatalog` |
| server | `src/contracts/settings.ts`（或同级） | 新增 `imageProviderCatalog` / `imageProviderModelItem` schema（图片模型无 reasoning/contextWindow，按实际字段定义） |
| app | `src/features/chat/ImageCard.tsx` | `ImageCardRenderer`：骨架屏 / `<img>` / 导出按钮 |
| app | 设置页 | 图片生成模型配置区（provider/model/key，多 provider 各自存 key） |

### 修改

| 层 | 文件 | 变更 |
|---|---|---|
| core | `src/tools/index.ts` | 注册 `generate_image` |
| app | `src/lib/types.ts` | 新增 `ImageCard` 接口；`_card: HtmlCard \| ImageCard`（判别联合，靠 `type` 字段区分） |
| app | `src/lib/tool-registry.ts` | `generate_image` label |
| core | `src/types.ts`（AppSettings） | `AppSettings` 扩展 image 字段：`imageGen?: { activeProvider: "openrouter"\|"zhipu"; activeModelId: string; keys: { openrouter?: string; zhipu?: string } }` |
| app | `electron/settings.ts` | `AppSettings` 序列化含 image 字段；新增 `applyImageSettingsToEnv(settings)` 写入三个 env（与现有 `applySettingsToEnv` 并列），在 `saveSettings` 末尾调用 |
| app | `electron/ipc/settings.ts` | `save-settings` IPC 无需改逻辑（已调 `saveSettings`，env 注入由其内部完成） |
| app | `src/lib/api.ts` | `getImageProviders()`（GET image-providers 目录）、`exportImage(srcRel, destAbs)` client 方法（图片配置读写复用现有 `getSettings`/`saveSettings` IPC，AppSettings 扩展 image 字段；IPC save 触发 `applyImageSettingsToEnv`） |
| app | `src/features/chat/MessageItem.tsx` | 按 `card.type` 分发到 `HtmlCardRenderer` / `ImageCardRenderer` |
| app | `src/features/chat/chat-session-reducer.ts` | 流式（`tool_execution_update`）+ 历史（`parseHistoryMessages`）两路按判别字段 `details.type === "image"` 识别并挂载 `_card`（与现有 `render_card` 的 `details.type === "html"` 并列，共用判别联合） |
| server | server 启动注册 | 挂载 images router |

## 数据模型

### `ImageCard`（app `src/lib/types.ts`）

```ts
export interface ImageCard {
  type: "image";
  status: "generating" | "done" | "error";
  path?: string;            // 相对路径，status:"done" 时有值
  prompt: string;
  model?: string;           // "provider/modelId"
  mimeType?: string;
  errorMessage?: string;    // status:"error" 时有值
}

export interface ToolCallInfo {
  // ...既有字段
  _card?: HtmlCard | ImageCard;   // 判别联合
}
```

### `AppSettings.imageGen`（core `src/types.ts`，存 electron-store）

```ts
// 扩展现有 AppSettings，新增可选字段
export interface AppSettings {
  providers: Record<string, { apiKey: string } | undefined>;
  defaultModel: string;
  locale: string;
  imageGen?: {                              // 图片生成配置（与 defaultModel/apiKeys 同处）
    activeProvider: "openrouter" | "zhipu"; // 与图片 provider 列表一致
    activeModelId: string;                  // 如 "google/gemini-2.5-flash-image" 或 "glm-image"
    keys: {                                 // 各 provider 独立存 key，切换 provider 不丢失
      openrouter?: string;
      zhipu?: string;
    };
  };
}
```

「是否启用」隐式化：`imageGen` 存在且 `activeProvider` + `activeModelId` + `keys[activeProvider]` 三者都非空即视为启用，不单独存 `enabled` 字段。

### 环境变量契约（core tool 读取，经 IPC save 注入）

`electron/settings.ts` 的 `applyImageSettingsToEnv(settings)` 在 `saveSettings` 末尾调用，写入：

| env 变量 | 值 |
|---|---|
| `SPHERSE_IMAGE_PROVIDER` | `imageGen.activeProvider`（`"openrouter" \| "zhipu"`） |
| `SPHERSE_IMAGE_MODEL` | `imageGen.activeModelId` |
| `SPHERSE_IMAGE_OPENROUTER_KEY` | `imageGen.keys.openrouter`（若有） |
| `SPHERSE_IMAGE_ZHIPU_KEY` | `imageGen.keys.zhipu`（若有） |

core `generate_image` tool 从 `process.env` 读这四个值，provider+model+对应 key 缺一即返回「未配置」错误。应用启动时（`ensureServer` 之前的 `restoreEnvFromSettings` 等价路径）也要调用 `applyImageSettingsToEnv` 确保重启后 env 就绪。

### `generate_image` tool 参数（core）

```ts
const GenerateImageParams = Type.Object({
  prompt: Type.String({ description: "图片描述（prompt）" }),
});
```

v1 不暴露 size/aspect/model 覆盖参数（模型与 key 由全局配置统一）。

### tool 返回 details（core）

```ts
{
  type: "image",
  status: "done",
  path: ".spherse/generated-images/20260620152345-a3b2.png",
  prompt, model, mimeType
}
```

## 文件系统约定

- 生成图片存于项目内隐藏目录 `.spherse/generated-images/`（与 `.spherse/` 元数据目录同级约定一致）
- 文件名 `<yyyyMMddHHmmss-UTC>-<4hex>.<ext>`（例 `20260620152345-a3b2.png`）：前段为生成时刻的 UTC 时间戳，4 位小写随机 hex 用于同秒去重；扩展名由 mimeType 映射 `image/png→png`、`image/jpeg→jpg`、`image/webp→webp`、`image/gif→gif`，未识别回退 `png`
- 通过现有 `GET /api/projects/:id/preview/<relPath>` 展示（preview API 已支持上述扩展名）
- 导出：复制（非移动）到用户选择路径，默认定位到**当前项目根目录**；隐藏目录中的原件保留（便于历史 card 仍可显示）

## 导出端点

`POST /api/projects/:projectId/images/export`

- body: `{ src: string(相对路径), dest: string(绝对路径) }`
- server 用 `resolveProjectPath` 校验 src 在项目内、用 `assertInsideProject` 校验 dest 在项目内
- `fs.copyFile(srcAbs, destAbs)`；导出为单用户交互（dialog 触发），无并发竞争，不加 mutex

## 错误处理

| 场景 | 行为 |
|---|---|
| 图片未配置（env 缺 provider/model/key 任一） | tool 直接返回 error content（不调 pi-ai），UI 在 ToolCallSection 显示错误，不挂 card |
| pi-ai `stopReason:"error"` 或 `errorMessage` | tool 返回 error content；若已 onUpdate 占位符，再 onUpdate `{status:"error",errorMessage}` 让 card 显示错误态 |
| 智谱 BigModel API 非 200 / 返回异常 | provider 实现归一化为 `AssistantImages.stopReason:"error"`，走同一错误分支 |
| output 无 image 块（模型只返回文本） | 同上 error |
| 写盘失败（权限/磁盘） | tool error，card 标 error |
| 导出目标越界 / dest 不在项目内 | server 400 |
| 生成被取消（abort） | pi-ai 透传 signal；tool 返回 aborted |

## 测试

**core（单测，mock generateImages）**
- 成功路径：断言写盘到正确路径、文件内容=Buffer、返回 `details` 形状、onUpdate 被调用 2 次（generating + done）
- env 读取：设置 `SPHERSE_IMAGE_PROVIDER/MODEL/KEY` → tool 正确解析 provider+modelId+apiKey 并传给 `generateImages`
- 文件名：匹配 `^\d{14}-[0-9a-f]{4}\.\w+$`（UTC 时间戳 + 4hex）
- 路径安全：destRel 必须落在 `.spherse/generated-images/` 内
- 各错误分支：env 缺 provider/model/key 任一、stopReason error、无 image 块、写盘失败
- 占位符 onUpdate 在 generateImages 调用之前发出

**electron settings（`applyImageSettingsToEnv`）**
- `imageGen` 三字段齐 → 三个 env 正确写入
- `imageGen` 缺失 → 不写 env（且不抛错）
- 切换 provider 后重写 → 新 key 进 env，旧 provider 的 env 清除

**core 智谱模块（`zhipu-images.ts`，mock BigModel HTTP）**
- `generateImagesZhipu`：b64_json 响应 → 归一化出 `ImageContent`（base64 + mimeType）；URL 响应 → fetch 取字节转 base64；非 200 / 缺图片字段 → `stopReason:"error"`
- `registerZhipuImages` 后，pi-ai `getImagesApiProvider("zhipu-images")` 返回已注册实现（验证接入 pi-ai 成功）
- `resolveZhipuImageModel("glm-image")` 返回的 `ImagesModel` 字面量可被 `generateImages` 正确派发到 zhipu 实现
- `ZHIPU_IMAGE_MODELS` 常量 shape 正确（含 id/provider/api/output）

**app reducer**
- 流式：收到 generate_image 的 tool_execution_update（generating）→ `_card.status==="generating"`；再收 done update → `status==="done"` 且 path 正确
- 历史：parseHistoryMessages 从 tool_result.details（type:image）重建 `_card`
- 与 render_card 并存不互相干扰

**server contract**
- `GET /api/settings/image-providers`：返回符合 `imageProviderCatalog` schema 的目录（含 openrouter + zhipu 两个 provider 条目）
- `/images/export`：越界 src/dest 拒绝（400）；合法路径 copy 成功

**app 组件（可选）**
- ImageCardRenderer 三态渲染（generating/done/error）+ 导出按钮点击触发 dialog

## 全局配置接入说明

图片生成配置（`AppSettings.imageGen`）存于 Electron `electron-store`，与 chat 的 `defaultModel`/API key 同处（详见「数据模型 → AppSettings.imageGen」）。注入路径与现有 API key 同构：renderer 经现有 `save-settings` IPC → `saveSettings()` → `applyImageSettingsToEnv()` 写入三个 env → core `generate_image` tool 从 `process.env` 直读（不经 core 运行时、不经 `ToolContext`）。各 provider 的 API Key 独立存储，切换 provider 时保留各自 key。设置页新增配置区：provider/model 下拉来自 `api.getImageProviders()`（经 server `/api/settings/image-providers` 透传 core 的 `getImageSupportedProviders()`）、key 输入框绑定 `imageGen.keys[activeProvider]`。

## Follow-up（v1 之后）

- image card 增加 `data-chat-image-card` 属性，纳入 chat theme 体系（同步更新 `packages/presets/skills/create-agent-chat-theme/`）
- img2img / 参考图输入（需打通图片输入到 tool 的路径）
- 多图返回、size/aspect/negative prompt 参数
- 用户在 composer 直发图片生成（非 agent 触发）
- 图片重生 / 局部编辑（inpaint）
