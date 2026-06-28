# 实施计划：升级 pi-agent-core 与 pi-ai 至 0.80.2

> Design: `docs/dev/infra/2026-06-28-pi-deps-upgrade-0802/design.md`

## 约束

- 所有变更集中在 `packages/core`（server/app 仅通过 `@spherse/core` 公共 API 消费，零改动）。
- `packages/core` 是单一编译单元，**全部迁移完成前 `tsc` 无法通过**。因此 Task 1 与 Task 2 存在严格顺序依赖。
- 文件所有权有重叠（`model-providers/index.ts`、`session-runtime.ts`、`generate-image.ts`），Task 1（机械更名）完成后 Task 2（API 迁移）才能开始。

## 任务拆分

```
Task 1 (机械更名) ──grep 验证──▶ Task 2 (API 迁移) ──tsc+test 验证──▶ 完成
```

---

## Task 1 — 包更名 + 版本升级（机械替换）

**文件：** `packages/core/package.json` + 15 个 `.ts` 源文件

**改动：**

1. `packages/core/package.json`：
   - `"@earendil-works/pi-ai": "^0.78.0"` → `"@earendil-works/pi-ai": "0.80.2"`
   - `"@mariozechner/pi-agent-core": "^0.72.1"` → `"@earendil-works/pi-agent-core": "0.80.2"`

2. 15 个文件，将 import 包名 `@mariozechner/pi-agent-core` → `@earendil-works/pi-agent-core`（import 符号名不变）：
   - `src/tools/{index,append-changelog,copy-file,edit-file,generate-image,list-files,load-skill,move-file,read-file,render-card,search-content,write-file}.ts`
   - `src/session-runtime.ts`
   - `src/engine/log-agent-event.ts`
   - `src/__tests__/engine/log-agent-event.test.ts`

3. `npm install`

**验证（此阶段 `tsc` 不会通过，仅做以下检查）：**
- `grep -r "@mariozechner/pi" packages/` → 零结果
- `ls node_modules/@mariozechner/` → 不存在
- `cat node_modules/@earendil-works/pi-ai/package.json | grep version` → `0.80.2`
- `cat node_modules/@earendil-works/pi-agent-core/package.json | grep version` → `0.80.2`

**提交点：** `chore: rename @mariozechner/pi-agent-core to @earendil-works/pi-agent-core, bump to 0.80.2`

---

## Task 2 — 迁移到 createModels() 新 API

**依赖：** Task 1 完成

**文件（4 源 + 2 测试）：**
- `src/model-providers/zhipu-images.ts`
- `src/model-providers/index.ts`
- `src/session-runtime.ts`
- `src/tools/generate-image.ts`
- `src/__tests__/zhipu-images.test.ts`
- `src/__tests__/tools/generate-image.test.ts`

### Step 2a — zhipu-images.ts：工厂函数化

1. 顶部 import 改为从根入口取 `createImagesProvider`、`envApiKeyAuth`、`ImagesProvider` 类型：
   ```typescript
   import { createImagesProvider, envApiKeyAuth } from "@earendil-works/pi-ai";
   import type { ImagesProvider, ImagesModel, ImagesContext, ProviderImagesOptions, AssistantImages, ImagesOptions } from "@earendil-works/pi-ai";
   ```
2. 移除 `registerImagesApiProvider` import 和模块顶层 `registerZhipuImages()` 副作用调用（删掉 `let registered` + `registerZhipuImages` 函数 + 底部 `registerZhipuImages()` 调用）。
3. 新增工厂函数（替代被删的注册逻辑）：
   ```typescript
   export function createZhipuImagesProvider(): ImagesProvider {
     return createImagesProvider({
       id: "zhipu",
       name: "智谱",
       auth: { apiKey: envApiKeyAuth("Zhipu image API key", ["SPHERSE_IMAGE_API_KEY"]) },
       models: Object.values(ZHIPU_IMAGE_MODELS).map((m) => ({
         id: m.id, name: m.name, provider: "zhipu" as const, api: m.api,
         baseUrl: m.baseUrl, input: m.input, output: m.output, cost: m.cost,
       })),
       api: { generateImages: generateImagesZhipu },
     });
   }
   ```
4. `ZHIPU_IMAGE_MODELS`、`resolveZhipuImageModel`、`generateImagesZhipu` 函数体不变。

### Step 2b — model-providers/index.ts：创建单例 + 迁移 catalog

1. 顶部 import 改造：
   ```diff
   - import { getProviders, getModels, getModel, getImageProviders, getImageModels } from "@earendil-works/pi-ai";
   + import { type Models, type ImagesModels } from "@earendil-works/pi-ai";
   + import { builtinModels, builtinImagesModels } from "@earendil-works/pi-ai/providers/all";
   + import type { StreamFn } from "@earendil-works/pi-agent-core";
   + import { createZhipuImagesProvider } from "./zhipu-images.js";
   ```
2. 模块顶层创建两个单例：
   ```typescript
   const models: Models = builtinModels();
   const imagesModels: ImagesModels = builtinImagesModels();
   imagesModels.setProvider(createZhipuImagesProvider());
   ```
3. `getSupportedProviders()`：`getProviders()` → `models.getProviders()`；`getModels(provider)` → `models.getModels(provider)`。其余过滤逻辑（`ENABLED_PROVIDERS`、display names、env keys）不变。
4. `resolveModelById()`：`(getModel as any)(provider, id)` → `models.getModel(provider, id)`——**消除 `as any`**。
5. `getImageSupportedProviders()`：重写为遍历 `imagesModels.getProviders()`，对每个 provider 调 `imagesModels.getModels(provider)`。删除原来对 zhipu 的特殊拼接（zhipu 现在是 imagesModels 中的普通 provider）。`IMAGE_PROVIDER_DISPLAY_NAMES`/`IMAGE_PROVIDER_ENV_KEYS` 仍用于 display name 和 env key 展示。
6. 新增两个导出：
   ```typescript
   export function getChatStreamFn(): StreamFn {
     return (model, context, options) => models.streamSimple(model, context, options);
   }
   export function getImagesModels(): ImagesModels {
     return imagesModels;
   }
   ```

### Step 2c — session-runtime.ts：接入新 streamFn

```diff
- import { streamSimple } from "@earendil-works/pi-ai";
+ import { getChatStreamFn } from "./model-providers/index.js";
```
```diff
- streamFn: streamSimple as any,
+ streamFn: getChatStreamFn(),
```

### Step 2d — generate-image.ts：统一走 ImagesModels

```diff
- import { generateImages, getImageModel } from "@earendil-works/pi-ai";
- import { resolveZhipuImageModel } from "../model-providers/zhipu-images.js";
+ import { getImagesModels } from "../model-providers/index.js";
```

`execute` 内部模型解析 + 生成逻辑改为：
```typescript
const imagesModels = getImagesModels();
// ...
const model = imagesModels.getModel(config.provider, config.modelId);
if (!model) { /* error: model not found */ }
// ...
const result = await imagesModels.generateImages(
  model,
  { input: [{ type: "text", text: prompt }] },
  { apiKey: config.apiKey, ...(signal ? { signal } : {}) },
);
```
删除原来的 `config.provider === "zhipu" ? resolveZhipuImageModel(...) : getImageModel(...)` 分支。tool 返回值结构（`AgentToolResult`、`details`、`onUpdate`）、写盘逻辑不变。

### Step 2e — 更新测试

**`__tests__/zhipu-images.test.ts`：**
- L1–176（`generateImagesZhipu` 函数级测试 + `resolveZhipuImageModel` + `ZHIPU_IMAGE_MODELS`）：不变。
- L178–184（registration 测试）：改为测工厂函数：
  ```typescript
  import { createZhipuImagesProvider } from "../model-providers/zhipu-images.js";
  it("createZhipuImagesProvider returns provider with generateImages", () => {
    const provider = createZhipuImagesProvider();
    expect(provider.id).toBe("zhipu");
    expect(typeof provider.generateImages).toBe("function");
    expect(provider.getModels().length).toBeGreaterThan(0);
  });
  ```

**`__tests__/tools/generate-image.test.ts`：**
- 删除 `vi.mock("@earendil-works/pi-ai", ...)`。
- 改为 mock `../../model-providers/index.js` 的 `getImagesModels`，返回带 `getModel`/`generateImages` 方法的 stub 对象。
- 调整 `beforeEach` 中 mock setup：`getImagesModels` 返回的 stub 的 `getModel` 返回 `{ id: "test-model", api: "..." }`，`generateImages` 返回 `mockAssistantImages()`。

**验证：**
```bash
npm run build --workspace=packages/core          # tsc strict 通过
npm test --workspace=packages/core               # 全部单测绿
npm run lint --workspace=packages/core           # 无 as any 残留
```

**全仓验证：**
```bash
npm run build                                    # core → server → app
npm run verify                                   # lint + build + tests + i18n
```

**提交点：** `feat(core): migrate pi-ai to createModels() provider-factory API`

---

## 自查清单

- [ ] `grep -r "as any" packages/core/src/` — 无新引入的 `as any`（原有的 SQLite row casting 等不在本次范围）
- [ ] `grep -r "@mariozechner/pi" packages/` — 零结果
- [ ] `grep -r "streamSimple\|getProviders\|getModels\|getModel\|generateImages\|getImageModel\|registerImagesApiProvider" packages/core/src/ | grep "from \"@earendil-works/pi-ai\""` — 无从根入口导入旧全局 API 的残留
- [ ] `node_modules/@mariozechner/` 不存在
- [ ] `npm run verify` 全绿
- [ ] `docs/official/` 无需更新（纯依赖升级，无结构/命名变化）
