# 实施计划：图片生成支持（v1）

对应 design：`docs/dev/features/2026-06-20-image-generation-support/design.md`

## 依赖图（箭头 = 任务依赖，B 需 A 完成才能开工）

```
T1 zhipu module ──────┬─→ T2 generate_image tool
                      └─→ T3 core catalog/types ──┬─→ T4 electron env
                                                  ├─→ T5 server routes (含 registerZhipuImages)
                                                  └─→ T6 app types+api ──┬─→ T7 reducer
                                                                          ├─→ T9 settings UI
                                                                          └─→ T8 ImageCard UI (另依赖 T7)
T8 → T10 (i18n+验证) ; T9 → T10
```

## 并行批次（subagent-driven 调度参考）

- **批次 A**：T1（独立）
- **批次 B（并行）**：T2（依赖 T1）、T3（依赖 T1）
- **批次 C（并行）**：T4（依赖 T3）、T5（依赖 T3 + T1）
- **批次 D**：T6（依赖 T5）
- **批次 E（并行）**：T7（依赖 T6）、T9（依赖 T6）
- **批次 F**：T8（依赖 T6 + T7）
- **批次 G**：T10（依赖 T8 + T9）

---

## T1 — core：智谱图片接入模块

**文件**：`packages/core/src/zhipu-images.ts`（新建）

**做什么**：
- `export const ZHIPU_IMAGE_MODELS`: 本地常量，仅 `glm-image`（字段 `{ id, provider:"zhipu", api:"zhipu-images", output:["image"], input:["text"], name }`）
- `export function resolveZhipuImageModel(modelId: string): ImagesModel<"zhipu-images">`：从 `ZHIPU_IMAGE_MODELS` 查；构造并返回 `ImagesModel` 字面量（pi-ai 无 registerImageModel hook，字面量可直接喂 `generateImages`，见 design 决策 #5）
- `export function generateImagesZhipu(model, context, options): Promise<AssistantImages>`：POST `https://open.bigmodel.cn/api/paas/v4/images/generations`，`Authorization: Bearer <apiKey>`（取 `options.apiKey`），body `{ model: model.id, prompt: <context.input 中 text>, size }`；归一化响应为 `AssistantImages`（`output: ImageContent[]`）。响应可能是 `{data:[{b64_json}]}` 或 `{data:[{url}]}`——优先发请求时带 `response_format:"b64_json"`，URL 则 fetch 取字节转 base64。非 200/缺图 → `stopReason:"error"` + `errorMessage`。
- `export function registerZhipuImages(): void`：调用 pi-ai 的 `registerImagesApiProvider({ api:"zhipu-images", generateImages: generateImagesZhipu })`。幂等（重复注册覆盖）。

**导出**：在 `packages/core/src/index.ts` 加 `export { registerZhipuImages, resolveZhipuImageModel, ZHIPU_IMAGE_MODELS } from "./zhipu-images.js";`（按实际外部消费裁剪）。

**关键参考**：pi-ai openrouter 实现 `dist/providers/images/openrouter.js`（已读，`/var/folders/.../pi-ai-inspect/`）；`ImageContent`/`AssistantImages` 类型见 pi-ai `dist/types.d.ts`。pi-ai 运行时类型：`ImagesApi = "openrouter-images" | (string & {})`（开放联合，`"zhipu-images"` 合法）。

**实现时需确认**：智谱 BigModel 实际响应 shape（curl 只给了 request）。实现者用一个真实 key 打一次，把响应贴进测试 fixture；或据智谱文档补。

**测试** `packages/core/src/__tests__/zhipu-images.test.ts`（mock fetch/undici）：
- `generateImagesZhipu`：b64_json 响应 → `ImageContent`（base64+mimeType）；URL 响应 → fetch 转字节再 base64；非 200 → `stopReason:"error"`；缺图字段 → error
- `registerZhipuImages` 后，pi-ai `getImagesApiProvider("zhipu-images")` 返回已注册实现
- `resolveZhipuImageModel("glm-image")` 返回 shape 正确（api/provider/output）
- `ZHIPU_IMAGE_MODELS` 常量 shape 正确

**验证**：`npm test --workspace=packages/core`

**依赖**：无

---

## T2 — core：generate_image 工具

**文件**：`packages/core/src/tools/generate-image.ts`（新建）；改 `packages/core/src/tools/index.ts`

**做什么**：
- `createGenerateImageTool(projectRoot: string): AgentTool<typeof GenerateImageParams>`，参数 schema = `Type.Object({ prompt: Type.String({description:"..."}) })`
- `execute(toolCallId, params, signal, onUpdate)`：
  1. `onUpdate?.({ content:[{type:"text",text:"generating..."}], details:{ type:"image", status:"generating", prompt: params.prompt } })` —— 占位符，**在调 pi-ai 之前**
  2. 从 `process.env` 读：`SPHERSE_IMAGE_PROVIDER`、`SPHERSE_IMAGE_MODEL`、`SPHERSE_IMAGE_OPENROUTER_KEY`(openrouter) / `SPHERSE_IMAGE_ZHIPU_KEY`(zhipu)。provider/model/对应 key 任一空 → 直接返回 error content `{ content:[{type:"text",text:"图片生成未配置：缺少 provider/model/apiKey"}] }`，**不挂 card**
  3. `model = provider==="openrouter" ? getImageModel("openrouter", modelId) : resolveZhipuImageModel(modelId)`（pi-ai `getImageModel` / T1 `resolveZhipuImageModel`）
  4. `const result = await generateImages(model, { input:[{type:"text", text: params.prompt}] }, { apiKey, signal })`（pi-ai `generateImages`）
  5. `result.stopReason==="error"` 或 `output` 无 `ImageContent` → 返回 error content；并 `onUpdate?.({..., details:{ type:"image", status:"error", prompt, errorMessage }})`
  6. 取首个 `ImageContent` → `Buffer.from(data,"base64")`
  7. `ext = MIME_TO_EXT[mimeType] ?? "png"`；`name = ${utcStamp(yyyyMMddHHmmss)}-${randomHex(4)}.${ext}`；`destRel = ".spherse/generated-images/"+name`
  8. `abs = resolveProjectPath(root, destRel)`；`fs.mkdir(dirname(abs), {recursive:true})`；若 abs 已存在则重新生成 hex（碰撞兜底）；`fs.writeFile(abs, buf)`
  9. `onUpdate?.({ content:[{type:"text",text:`已生成图片：${prompt}`}], details:{ type:"image", status:"done", path: destRel, prompt, model:`${provider}/${modelId}`, mimeType, cardType:"image" } })` —— **注意 `cardType:"image"`**：历史恢复 reducer 路径读 `details.cardType`（见 `chat-session-reducer.ts:216` 的 render_card 先例用了 `cardType`，而流式读 `details.type`，所以 done details 同时含 `type` 和 `cardType` 双键，与 render_card 既有行为一致）
  10. `return { content:[{type:"text",text:`已生成图片：${prompt}`}], details:{ type:"image", cardType:"image", status:"done", path: destRel, prompt, model, mimeType } }`
- 注册：`packages/core/src/tools/index.ts` 加 `generate_image: createGenerateImageTool(ctx.root)` 到 `createToolsForProject` 的 tools map（注意：不需要 mutex/policy，仅需 projectRoot）
- **不要**改 `tool-context.ts`（设计决策 #4：不经 ToolContext getter，直读 env）

**注意**：`generateImages`/`getImageModel`/`registerImagesApiProvider` 等需在 server 启动时先调 `registerZhipuImages()` 一次——此调用放在 T5 server 启动注册，或放 T1 模块 import 副作用（参考 pi-ai `register-builtins.js` 也是 import 副作用）。建议：T1 模块顶层不加副作用，由 server 启动显式调 `registerZhipuImages()`（T5 负责）。

**测试** `packages/core/src/__tests__/generate-image.test.ts`（mock `generateImages`，可用临时目录写盘）：
- 成功：mock 返回 `ImageContent` → 断言写盘路径在 `.spherse/generated-images/`、文件内容=`Buffer.from(mockBase64,"base64")`、返回 `details` shape、`onUpdate` mock 被调 2 次（第 1 次在调 generateImages 之前，且 `status:"generating"`）
- env 读取：分别设 `SPHERSE_IMAGE_PROVIDER="openrouter"`/`"zhipu"` → 断言传给 `generateImages` 的 model 正确
- 文件名正则：`^\d{14}-[0-9a-f]{4}\.\w+$`
- 错误分支：env 三者缺一 → error content 且**不调** generateImages；`stopReason:"error"` → error；无 image 块 → error；写盘失败（mock fs 抛错）→ error
- 每个 error 后若已发占位符 onUpdate，再发一次 `status:"error"` 的 onUpdate

**验证**：`npm test --workspace=packages/core`

**依赖**：T1

---

## T3 — core：AppSettings.imageGen 类型 + getImageSupportedProviders

**文件**：`packages/core/src/types.ts`（改 AppSettings）；`packages/core/src/model-providers.ts`（加函数）；`packages/core/src/index.ts`（导出）

**做什么**：
- `AppSettings` 加可选字段 `imageGen?: { activeProvider: "openrouter"|"zhipu"; activeModelId: string; keys: { openrouter?: string; zhipu?: string } }`（参考现有 `AppSettings` 定义位置，`types.ts`）
- `getImageSupportedProviders(): ImageProviderCatalog`：参考现有 `getSupportedProviders()`（`model-providers.ts:62-96`）的 shape（`ProviderCatalog` / `ProviderCatalogItem` / `ProviderModelItem`），但数据源 = pi-ai 图片目录（`getImageProviders()`/`getImageModels("openrouter")`）+ `ZHIPU_IMAGE_MODELS`（T1）。返回可序列化纯数据。图片 provider 的 `auth`：openrouter 用 `{type:"apiKey", envKeys:["SPHERSE_IMAGE_OPENROUTER_KEY"]}`、zhipu 用 `{type:"apiKey", envKeys:["SPHERSE_IMAGE_ZHIPU_KEY"]}`（envKeys 仅用于 UI 展示，实际 env 注入在 T4）。**注意**：这里复用 chat 的 `ProviderCatalog` shape 即可（`reasoning` 填 false，`contextWindow`/`maxTokens` 可选省略），以最小化 contract 改动——重新评估：design 说新建 `imageProviderCatalog` schema，但如果复用 `ProviderCatalogContract` 能避免新增 schema 且字段可填齐（reasoning=false, input/output 填实际），则**优先复用**，减少 T5 工作量。实现时二选一，倾向复用。
- 导出 `getImageSupportedProviders` 到 `packages/core/src/index.ts`

**测试** `packages/core/src/__tests__/model-providers.test.ts`（追加或新建）：
- `getImageSupportedProviders()` 返回含 `openrouter` 和 `zhipu` 两个 key
- openrouter 条目 models 非空；zhipu 条目 models 含 `glm-image`
- AppSettings.imageGen 字段类型可赋值（TS 编译通过）

**验证**：`npm test --workspace=packages/core`

**依赖**：T1（需 `ZHIPU_IMAGE_MODELS`）

---

## T4 — electron：图片配置 env 注入

**文件**：`packages/app/electron/settings.ts`（改）；`packages/app/shared/electron-api.ts`（改 `IpcAppSettings`）

**做什么**：
- `IpcAppSettings`（`electron-api.ts:14-18`）加 `imageGen?: AppSettings["imageGen"]`
- `getMaskedSettings()`（`settings.ts:33-43`）：把 `imageGen` 透传，key 按 chat 的 maskApiKey 规则掩码后返回（避免明文 key 进 renderer）
- `saveSettings()`（`settings.ts:45-60`）：与 chat apiKey 同样的「保留旧 key」逻辑处理 imageGen 的两个 key（空串跳过、含 `****` 保留旧值）；末尾调 `applyImageSettingsToEnv(merged)`
- 新增 `applyImageSettingsToEnv(settings: AppSettings): void`（与 `applySettingsToEnv` 并列，`settings.ts:68`）：按 design env 表写 `process.env.SPHERSE_IMAGE_PROVIDER/MODEL/OPENROUTER_KEY/ZHIPU_KEY`；`imageGen` 缺失则清空四个 env（确保切换 provider 后旧 key 不残留）
- `restoreEnvFromSettings()`（`settings.ts:62-66`）：末尾也调 `applyImageSettingsToEnv`（确保应用重启后 env 就绪）
- `ipc/settings.ts` 的 `save-settings` IPC 无需改逻辑（已调 `saveSettings`，env 注入在内部）

**测试** `packages/app/electron/__tests__/settings.test.ts`（若不存在则新建；mock electron-store）：
- `applyImageSettingsToEnv`：imageGen 三字段齐 → 四个 env 正确写；imageGen 缺失 → 四个 env 清空且不抛错
- 切换 provider 重写 → 新 key 进 env，旧 provider env 清除
- saveSettings 对 imageGen key 的「空串跳过/掩码保留旧值」逻辑（与 chat key 一致）

**验证**：`npm run lint --workspace=packages/app` + 该测试

**依赖**：T3（AppSettings.imageGen 类型）

---

## T5 — server：images 路由 + 契约 + 智谱注册

**文件**：`packages/server/src/routes/images.ts`（新建）；`packages/server/src/contracts/`（视 T3 决定是否新增 schema）；server 启动注册 + `registerZhipuImages()`

**做什么**：
- `GET /api/settings/image-providers`（无 projectId，全局）：handler 调 core `getImageSupportedProviders()` 返回。response schema：若 T3 复用 chat `ProviderCatalogContract` 则用 `schemas.providerCatalog`；否则在 `contracts/settings.ts` 加 `imageProviderCatalog` schema 并导出到 `contracts/index.ts`
- `POST /api/projects/:projectId/images/export`：body `{ src: string, dest: string }`；server 用 `resolveProjectPath(root, src)` 校验 src、`assertInsideProject(root, dest, dest)` 校验 dest；`fs.copyFile(srcAbs, destAbs)`；返回 `{ ok: true }`。body schema 用 inline Typebox 或加 contract。dest 需 `fs.mkdir(dirname, {recursive:true})`
- server 启动时（找到 server bootstrap，参考现有 router 注册处如 `routes/settings.ts` 的 `registerSettingsRoutes`）注册 images router；**并在启动时调一次** `registerZhipuImages()`（core 导出，T1），确保 pi-ai 运行时知道 zhipu-images provider
- 若新增契约 schema，同步导出到 `contracts/index.ts` 的 `schemas` 和 `export type`

**测试** `packages/server/src/__tests__/images.test.ts`（contract test，参考现有 server 测试风格）：
- `GET /api/settings/image-providers` 200，返回符合 schema，含 openrouter + zhipu
- `POST /images/export`：合法 src（先在 temp project 写个测试图）+ dest → 200 且 dest 文件存在/内容一致；越界 src（`../../etc/passwd`）→ 400/拒绝；越界 dest → 400

**验证**：`npm test --workspace=packages/server`

**依赖**：T3（getImageSupportedProviders）；T1（registerZhipuImages）

---

## T6 — app：类型 + tool-registry + api client

**文件**：`packages/app/src/lib/types.ts`（改）；`packages/app/src/lib/tool-registry.ts`（改）；`packages/app/src/lib/api.ts`（改）

**做什么**：
- `lib/types.ts`：新增 `ImageCard` 接口（见 design 数据模型）；`ToolCallInfo._card` 改为 `HtmlCard | ImageCard`
- `lib/tool-registry.ts`：加 `generate_image` label 项（参考现有 `render_card` 项的格式）
- `lib/api.ts`：
  - `getImageProviders(): Promise<ProviderCatalogContract>` → `GET ${baseUrl}/api/settings/image-providers`，`parseJsonResponse(res, schemas.providerCatalog)`（或新 schema）
  - `exportImage(srcRel: string, destAbs: string): Promise<{ok:boolean}>` → `POST ${apiBase}/projects/:projectId/images/export`，body `{src, dest}`，`assertOk`
  - 图片配置读写**复用**现有 `getSettings()`/`saveSettings()` IPC（AppSettings 已含 imageGen，T4）

**测试**：现有 `api.ts`/store 测试加 mock；或结构测试覆盖

**验证**：`npm run lint --workspace=packages/app` + `npm test --workspace=packages/app`

**依赖**：T5（契约 + 路由）

---

## T7 — app reducer：image card 挂载

**文件**：`packages/app/src/features/chat/chat-session-reducer.ts`（改）

**做什么**：
- **流式路径**（`tool_execution_update` 分支，`:132-154`）：现有仅识别 `render_card` + `details.type==="html"`。新增：`details.type === "image"`（或 toolName==="generate_image"）→ `updated._card = details`（details 已是 ImageCard shape）。注意：image 的 onUpdate details 用 `type:"image"`，直接赋给 `_card`
- **历史路径**（`parseHistoryMessages`，`:214-227`）：现有识别 `content.name==="render_card" && toolResult.details.cardType==="html"`。新增：`toolResult.details?.cardType === "image"`（或 `details.type === "image"`）→ 从 details 构造 `ImageCard` 赋给 `base._card`。details 字段：`{ type:"image", cardType:"image", status, path, prompt, model, mimeType }`（T2 返回的 details 同时含 type 和 cardType，两路都能命中）
- `_card` 类型已是 `HtmlCard | ImageCard`（T6 改过）

**测试** `packages/app/src/features/chat/__tests__/chat-session-reducer.test.ts`（追加）：
- 流式：发 `tool_execution_start`(generate_image) + `tool_execution_update`(details.type:"image",status:"generating") → `_card.status==="generating"`；再发 `tool_execution_update`(status:"done",path) → `status:"done"` 且 path 正确
- 历史：`parseHistoryMessages` 喂含 generate_image toolCall + 对应 toolResult(details.cardType:"image") → 重建 `_card`（status:"done", path 正确）
- 与 render_card 并存：同一历史含 render_card + generate_image 两条 toolCall，各自 `_card.type` 正确、不串扰

**验证**：`npm test --workspace=packages/app`

**依赖**：T6（ImageCard 类型）

---

## T8 — app：ImageCard 组件 + MessageItem 分发

**文件**：`packages/app/src/features/chat/ImageCard.tsx`（新建）；`packages/app/src/features/chat/MessageItem.tsx`（改）

**做什么**：
- `ImageCardRenderer({ card }: { card: ImageCard })`：
  - `status:"generating"` → 骨架屏/spinner（固定高度容器 + 居中 loading icon，用 lucide-react `Loader2` + animate-spin）
  - `status:"error"` → 错误态（`errorMessage` + `text-destructive`）
  - `status:"done"` → `<img src={client.getPreviewUrl(card.path)}>`（`useProjectCtx()` 取 client），`group/card` hover 显示右上角导出按钮（参考 `HtmlCard.tsx:22-49` 的 `group/card` + save 按钮模式）；图片样式 `max-w-full rounded-md border border-border`
  - 导出按钮：`window.electronAPI.showSaveDialog({ defaultPath: projectRoot + "/" + 默认名 })`（projectRoot 从 `useProjectCtx()`）→ 校验 `filePath.startsWith(projectRoot+"/")` → `client.exportImage(card.path, destAbs)` → `sonner` toast 成功/失败。默认文件名：`${timestamp}.png`（从 card.path 推导 ext）
- `MessageItem.tsx`（`:41-45` 现有 `toolCall._card` map）：按 `card.type` 分发——`"html"` → `<HtmlCardRenderer>`、`"image"` → `<ImageCardRenderer>`
- 用 `useProjectCtx()`（非 props 透传 client，遵循 AGENTS.md 前端 DI 规范）
- i18n：按钮/状态文案先 hardcode 中文，T10 统一迁移（或本 task 直接用 `useI18n` + 临时 key）

**测试** `packages/app/src/features/chat/__tests__/ImageCard.test.tsx`（或追加 MessageItem 结构测试）：
- 三态渲染（generating/done/error）DOM 正确
- done 态点导出按钮 → showSaveDialog + exportImage 被调（mock）

**验证**：`npm run lint --workspace=packages/app` + `npm test --workspace=packages/app`

**依赖**：T6（类型+api）、T7（reducer 挂 _card）

---

## T9 — app：设置页图片生成配置区

**文件**：`packages/app/src/features/settings/`（改 `use-settings-form.ts` + 设置页组件）

**做什么**：
- 在现有设置页新增「图片生成」配置区：
  - provider 下拉：`api.getImageProviders()` → keys（openrouter/zhipu）+ 显示名
  - model 下拉：按选中 provider 取 models（openrouter 来自 catalog、zhipu 来自 catalog）
  - apiKey 输入：绑定 `imageGen.keys[activeProvider]`（mask 显示，与 chat apiKey 输入一致）
- 扩展 `use-settings-form.ts`：state 加 `imageProvider`/`imageModel`/`imageKeys`；`save()` 时把 imageGen 并入 AppSettings payload；从 `getSettings()` 读回 imageGen 初始化
- 复用现有 save IPC（AppSettings 已含 imageGen），无需新 IPC

**测试**：表单初始化/保存 round-trip（mock api）

**验证**：`npm run lint --workspace=packages/app`

**依赖**：T6（getImageProviders api）

---

## T10 — i18n + 文档同步 + 最终验证

**做什么**：
- 用 i18n skill 把 T8/T9 新增的用户可见文案迁移到 `packages/i18n`：`zh-CN.ts`（基准，带注释）→ `zh-TW.ts`、`en.ts`。文案清单：图片生成配置区标题/字段、image card 导出按钮/成功失败 toast、生成中/错误态文案、未配置错误提示
- 更新 `docs/dev/backlog.md`（该 feature 条目 `[ ]` → `[x]`）
- 检查 `docs/official/` 是否需同步（如工具列表、设置项说明）
- 运行 `npm run i18n:check`（或等价命令，确认 key 完整）

**验证**：
```
npm run lint
npm run build
npm test --workspace=packages/core
npm test --workspace=packages/server
npm test --workspace=packages/i18n
npm test --workspace=packages/app
npm run verify
```
按 AGENTS.md「E2E 验证选择」：本 feature 影响 chat/session，跑 `npm run test:e2e --workspace=packages/app -- e2e/chat-streaming-resilience.spec.ts`（或相关 chat spec）确认无回归。

**依赖**：T8、T9

---

## 跨 task 约定

- **不加注释**（AGENTS.md），除非用户要求
- **路径安全**：所有项目内路径走 `resolveProjectPath`/`assertInsideProject`（T2 写盘、T5 export）
- **导出规范**：`packages/core/src/index.ts` barrel 只导出外部实际消费的符号，定期裁剪
- **契约规范**：HTTP schema 统一在 `@spherse/server/contracts`，server route + renderer client 复用同一 schema/parser，不裸 `JSON.parse`
- **commit**：完成代码后不自动 commit，等用户明确要求
- **store/组件规范**：遵循 AGENTS.md（feature-local 状态不提全局、`useProjectCtx` 不透传 client、组件 ~150 行软阈值）
