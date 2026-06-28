# 升级 pi-agent-core 与 pi-ai 至 0.80.2

## 背景

Spherse 的 agent 运行时依赖两个上游包：

| 包 | 当前版本 | 目标版本 |
|---|---|---|
| `@mariozechner/pi-agent-core` | `^0.72.1`（实际 0.72.1） | — |
| `@earendil-works/pi-agent-core` | 未使用 | `0.80.2` |
| `@earendil-works/pi-ai` | `^0.78.0`（实际 0.78.0） | `0.80.2` |

升级涉及三件互相耦合的事：

1. **包更名**：`@mariozechner/pi-agent-core`（旧名，最高 0.73.1）→ `@earendil-works/pi-agent-core`（新名，0.80.2）。旧名已停止发布，必须更名才能升级。
2. **pi-ai v0.80.0 breaking change**：旧全局 API（`streamSimple`/`getModel`/`getModels`/`getProviders`/`generateImages`/`registerImagesApiProvider` 等）从 `@earendil-works/pi-ai` 根入口移到了 `@earendil-works/pi-ai/compat` 子路径；同时引入了新的 `createModels()`/`createProvider()` provider-factory API。
3. **依赖树统一**：当前 pi-agent-core@0.72.1 内部仍依赖 `@mariozechner/pi-ai`（旧名），导致项目同时安装 `@mariozechner/pi-ai`（transitive）和 `@earendil-works/pi-ai`（direct）两份 pi-ai，类型不匹配，迫使多处 `as any` 强转。0.80.2 的 pi-agent-core 依赖 `@earendil-works/pi-ai`，升级后只剩一份 pi-ai，类型自然统一。

## 目标

1. 将 `@mariozechner/pi-agent-core` 更名为 `@earendil-works/pi-agent-core`，两者统一升级到 `0.80.2`。
2. 从旧全局 API 迁移到 `createModels()`/`createImagesModels()` provider-factory 新 API，不引入 `/compat` 依赖。
3. 消除因双 pi-ai 导致的 `as any` 强转（`session-runtime.ts` 的 `streamSimple as any`、`model-providers/index.ts` 的 `getModel as any`、`generate-image.ts` 的 `getImageModel as any` / `model as any`）。
4. 不改变现有对外 API 契约（`getSupportedProviders()`、`getImageSupportedProviders()`、`resolveModelById()`、`SessionRuntime` 构造签名保持不变），调用方（server routes、Electron IPC）零改动。

非目标：不在本次迁移 OAuth 认证流、动态 model refresh、多 credential store 等 Models 新能力——仅做等价迁移。

## 新旧 API 映射

### Chat 模型目录与流式

| 旧（全局 API） | 新（Models 实例） |
|---|---|
| `import { getProviders } from "@earendil-works/pi-ai"` | `models.getProviders()` |
| `import { getModels } from "@earendil-works/pi-ai"; getModels(provider)` | `models.getModels(provider)` |
| `import { getModel } from "@earendil-works/pi-ai"; getModel(provider, id)` | `models.getModel(provider, id)` |
| `import { streamSimple } from "@earendil-works/pi-ai"` | `models.streamSimple(model, ctx, opts)` |

新 API 的 provider 工厂通过 `envApiKeyAuth("名称", ["ENV_VAR"])` 声明环境变量，`Models` 内部用 `AuthContext.env()`（默认读 `process.env`）解析——与现有 `applySettingsToEnv` → `process.env[envKey]` 注入方式完全同构，API key 解析行为不变。

### 图片生成

| 旧（全局 API） | 新（ImagesModels 实例） |
|---|---|
| `registerImagesApiProvider(provider, sourceId)` | `imagesModels.setProvider(createImagesProvider(opts))` |
| `getImageProviders()` / `getImageModels(provider)` / `getImageModel(provider, id)` | `imagesModels.getProviders()` / `.getModels(provider)` / `.getModel(provider, id)` |
| `generateImages(model, ctx, opts)` | `imagesModels.generateImages(model, ctx, opts)` |

### 导入路径

| 内容 | 来源 |
|---|---|
| 类型（`Model`/`Api`/`Context`/`AssistantMessage`/`ImagesModel`/`ImagesOptions`/`AssistantImages`/`ImageContent`/`Message`/…） | `@earendil-works/pi-ai`（根，side-effect-free） |
| `createModels`/`createProvider`/`createImagesModels`/`createImagesProvider`/`envApiKeyAuth` | `@earendil-works/pi-ai`（根） |
| `builtinModels`/`builtinImagesModels`/`builtinProviders`/各 provider 工厂（`openaiProvider()` 等） | `@earendil-works/pi-ai/providers/all` |
| `Agent`/`AgentEvent`/`AgentTool`/`AgentState`/`AgentMessage` | `@earendil-works/pi-agent-core`（更名后） |

根入口 `sideEffects` 不含 compat/images，import 根不会拉入旧全局 API 副作用。

## 设计

分 4 个独立 chunk，可分别落地、分别验证。

### Chunk 1 — 更名 pi-agent-core + 升级版本

修改 `packages/core/package.json`：

```diff
- "@earendil-works/pi-ai": "^0.78.0",
- "@mariozechner/pi-agent-core": "^0.72.1",
+ "@earendil-works/pi-ai": "0.80.2",
+ "@earendil-works/pi-agent-core": "0.80.2",
```

全仓 15 个文件的 import 从 `@mariozechner/pi-agent-core` 改为 `@earendil-works/pi-agent-core`：

- `src/tools/*.ts`（12 个工具文件，仅 `import type { AgentTool }`）
- `src/session-runtime.ts`（`Agent`、`AgentEvent`、`AgentTool`）
- `src/engine/log-agent-event.ts`（`AgentEvent`）
- `src/__tests__/engine/log-agent-event.test.ts`（`AgentEvent`）

执行 `npm install`，确认 `@mariozechner/pi-ai` 和 `@mariozechner/pi-agent-core` 从 lockfile/node_modules 消失，只剩 `@earendil-works/pi-ai`@0.80.2 和 `@earendil-works/pi-agent-core`@0.80.2。

此 chunk 完成后代码还不能编译（pi-ai 的导入仍指向已移走的旧全局 API），但包更名本身是独立的机械替换。

### Chunk 2 — 迁移 chat 模型目录到 `createModels()`

改造 `src/model-providers/index.ts`：

1. 在模块顶层创建单例：

```typescript
import { createModels, type Models } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

const models: Models = builtinModels();
```

2. `getSupportedProviders()` 遍历 `models.getProviders()` 替代 `getProviders()`，过滤逻辑（`ENABLED_PROVIDERS`、`PROVIDER_DISPLAY_NAMES`、`PROVIDER_ENV_KEYS`）不变。`getModels(provider)` → `models.getModels(provider)`。

3. `resolveModelById(modelId)` 用 `models.getModel(provider, id)` 替代 `(getModel as any)(provider, id)`——**消除 `as any`**。`Model<Api>` 返回类型现在与 `Agent` 的 `initialState.model` 类型匹配。

4. 新增导出 `getChatStreamFn()` 供 `SessionRuntime` 使用（见 Chunk 3）：

```typescript
export function getChatStreamFn(): StreamFn {
  return (model, context, options) => models.streamSimple(model, context, options);
}
```

其中 `StreamFn` 从 `@earendil-works/pi-agent-core` 导入。`models.streamSimple` 的签名 `(model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream` 满足 `StreamFn` 契约——**消除 `streamSimple as any`**。

### Chunk 3 — SessionRuntime 接入新 streamFn

改造 `src/session-runtime.ts`：

```diff
- import { streamSimple } from "@earendil-works/pi-ai";
+ import { getChatStreamFn } from "./model-providers/index.js";
```

```diff
- streamFn: streamSimple as any,
+ streamFn: getChatStreamFn(),
```

`resolveModelById` 的 import 不变（函数签名不变）。此 chunk 消除 `session-runtime.ts:194` 的 `as any`。

### Chunk 4 — 迁移图片生成到 `createImagesModels()`

**4a. 改造 `src/model-providers/zhipu-images.ts`**：

`generateImagesZhipu` 函数体不变（仍是直接 POST BigModel API）。移除 `registerImagesApiProvider` 侧作用注册，改为工厂函数：

```typescript
import { createImagesProvider, envApiKeyAuth, type ImagesProvider } from "@earendil-works/pi-ai";

export function createZhipuImagesProvider(): ImagesProvider {
  return createImagesProvider({
    id: "zhipu",
    name: "智谱",
    auth: { apiKey: envApiKeyAuth("Zhipu image API key", ["SPHERSE_IMAGE_API_KEY"]) },
    models: Object.values(ZHIPU_IMAGE_MODELS).map((m) => ({
      id: m.id, name: m.name, provider: "zhipu", api: m.api,
      baseUrl: m.baseUrl, input: m.input, output: m.output, cost: m.cost,
    })),
    api: { generateImages: generateImagesZhipu },
  });
}
```

`ZHIPU_IMAGE_MODELS` 常量和 `resolveZhipuImageModel` 保留。模块顶层不再执行 `registerZhipuImages()` 副作用。

**4b. 改造 `src/model-providers/index.ts` 图片目录**：

模块顶层创建 `ImagesModels` 单例，注册 builtin + zhipu：

```typescript
import { createImagesModels, type ImagesModels } from "@earendil-works/pi-ai";
import { builtinImagesModels } from "@earendil-works/pi-ai/providers/all";
import { createZhipuImagesProvider } from "./zhipu-images.js";

const imagesModels: ImagesModels = builtinImagesModels();
imagesModels.setProvider(createZhipuImagesProvider());
```

`getImageSupportedProviders()` 遍历 `imagesModels.getProviders()` 替代 `getImageProviders()`/`getImageModels()`。zhipu 不再特殊拼接（它现在是 `imagesModels` 中的正常 provider）。

**4c. 改造 `src/tools/generate-image.ts`**：

在 `src/model-providers/index.ts` 导出 `getImagesModels(): ImagesModels`（返回模块单例，与 `getChatStreamFn()` 同模式）。tool 内部：

```diff
- import { generateImages, getImageModel } from "@earendil-works/pi-ai";
- import { resolveZhipuImageModel } from "../model-providers/zhipu-images.js";
+ import { getImagesModels } from "../model-providers/index.js";
+
+ const imagesModels = getImagesModels();
```

模型解析统一走 `imagesModels.getModel(config.provider, config.modelId)`——不再区分 zhipu/openrouter 两条路径（都注册在 `imagesModels` 里）。生成走 `imagesModels.generateImages(model, context, options)`。**消除 `getImageModel as any` 和 `model as any`**。

tool 的 `execute` 签名、返回值 `AgentToolResult` 结构、`onUpdate` 回调、写盘逻辑全部不变。

## agent-core 行为变化评估

0.72.1 → 0.80.2 的 agent-core 行为差异（已读源码确认）：

| 变化点 | 影响 | 处置 |
|---|---|---|
| `prompt()` 在已有 activeRun 时 throw | session 单线程串行处理，server 层已序列化同一 session 的消息 | 无需改 |
| `subscribe(listener)` listener 多收一个 `signal: AbortSignal` 参数 | 现有 listener `(event) => void` 结构兼容（多出的参数 TS 自动忽略） | 无需改 |
| 新增 `prepareNextTurn`/`shouldStopAfterTurn`/steering queue 等 options | 纯增量，不传则不启用 | 无需改 |
| `AgentEvent` 类型集合（10 种）不变 | 前端 WS event 处理、`log-agent-event` 均不受影响 | 无需改 |
| `AgentTool<TParameters, TDetails>` 接口不变（`execute`/`label`/`parameters`/`onUpdate`） | 12 个 tool 定义零改动 | 无需改 |
| pi-agent-core 内部 typebox 用 `typebox@1.1.38`，Spherse tool schema 用 `@sinclair/typebox@^0.34` | 升级前即如此，结构兼容，升级不引入新问题 | 无需改 |

## 测试更新

| 测试文件 | 改动 |
|---|---|
| `__tests__/engine/log-agent-event.test.ts` | import 更名（Chunk 1） |
| `__tests__/zhipu-images.test.ts` L50–176（`generateImagesZhipu` 函数级测试） | 不变（直接测函数） |
| `__tests__/zhipu-images.test.ts` L178–184（registration 测试） | 改为测 `createZhipuImagesProvider()` 返回的 provider 有 `generateImages` 函数 |
| `__tests__/tools/generate-image.test.ts` | 重写 mock：不再 mock `@earendil-works/pi-ai` 的全局函数，改为 mock `getImagesModels()` 返回的 `ImagesModels` 实例（`getModel`/`generateImages` 方法） |

## 验证

1. `npm install` 后检查 `node_modules/@mariozechner/` 不存在，`@earendil-works/pi-ai` 和 `@earendil-works/pi-agent-core` 均为 0.80.2。
2. `npm run lint --workspace=packages/core` — 确认无 `as any` 残留、无未使用 import。
3. `npm run build --workspace=packages/core` — 类型检查通过（`tsc` strict）。
4. `npm test --workspace=packages/core` — 69+ 现有单测全绿 + 更新后的 image/zhipu 测试。
5. `npm run build` — 全仓 build（core → server → app）通过。
6. `npm run verify` — lint + build + 全部 unit tests + i18n check。
7. 手动冒烟（可选）：`npm run dev` 启动桌面应用，发起一次 agent 对话确认流式输出正常、设置页 provider 列表正常渲染。

## 风险

| 风险 | 评估 | 缓解 |
|---|---|---|
| `builtinModels()` 未注册 Spherse 需要的某个 provider | 11 个 ENABLED_PROVIDERS（openai/anthropic/google/deepseek/zai/minimax/minimax-cn/xiaomi/moonshotai/moonshotai-cn/xai）均有对应工厂（`builtinProviders()` 列表已确认包含全部） | 低 |
| `envApiKeyAuth` 解析行为与旧 `getEnvApiKey` 不一致 | 新 API `resolve()` 合并 credential + ambient env，Spherse 无 credential store（空 InMemoryStore），走纯 env 解析，与旧行为等价 | 低 |
| `Models.streamSimple` 返回 `AssistantMessageEventStream`（sync）vs `StreamFn` 期望 `... | Promise<...>` | sync 是 union 的子集，赋值合法，arrow wrapper 显式满足 | 低 |
| `@sinclair/typebox` 与 `typebox` 跨包 TSchema 兼容 | 升级前已如此，一直编译通过 | 低 |
| pi-ai 0.78→0.80 间 model metadata 变化影响 UI 列表 | catalog 由 pi-ai 生成 metadata 驱动，升级后列表可能增减模型——这是预期行为（用户获得新模型） | 无需缓解 |

## 文档同步

- 无新增目录/命名约定，`docs/official/` 无需更新。
- `docs/dev/backlog.md`：本次为 infra 升级，无对应 backlog 条目；完成后可追加一条记录 createModels() 迁移已完成。
