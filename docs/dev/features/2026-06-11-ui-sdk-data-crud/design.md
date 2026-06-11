# [Feature] UI SDK Data CRUD — 结构化对单文件内容的增删改查能力

## 1. 概述

在现有 UI SDK（单向 postMessage 触发 UI 操作）基础上，新增 key-value 数据持久化能力。iframe 内 HTML 可通过 postMessage 对与自身关联的 JSON 文件进行 get/set/delete 操作，并获取返回值，实现交互式网页的数据持久化。

### 目标

赋予 LLM 生成的 HTML 页面简单的数据持久化能力（如游戏存档、表单数据、状态记录），增强可玩性。

### 核心场景

- iframe 内游戏 HTML 调用 `data.set("score", 100)` 保存分数，刷新后 `data.get("score")` 恢复
- 表单页面调用 `data.set("draft", {...})` 保存草稿
- 交互式图表调用 `data.get("state")` 恢复上次的交互状态

### 设计原则

- **零依赖**：iframe 端使用浏览器原生 `postMessage`，不注入脚本
- **请求-响应模式**：通过 `requestId` + `event.source.postMessage` 实现回调
- **按页面隔离**：每个 HTML 文件对应独立的 `.data.json` 文件
- **统一入口**：data action 注册到现有 UI SDK registry，与 createSession/openFile 一致

## 2. 协议层

### 2.1 请求消息

在现有 `spherse:action` 消息基础上增加 `requestId` 字段：

```typescript
interface SpherseActionMessage {
  type: "spherse:action";
  action: "data.get" | "data.set" | "data.delete";
  params: {
    key: string;
    value?: unknown;   // data.set 时必填
  };
  requestId: string;   // 调用方生成的唯一 ID，用于匹配响应
}
```

### 2.2 响应消息

新增 `spherse:response` 消息类型，由 app 通过 `event.source.postMessage` 回传给 iframe：

```typescript
interface SpherseResponseMessage {
  type: "spherse:response";
  requestId: string;
  ok: boolean;
  data?: unknown;
}
```

### 2.3 调用流程

```
iframe                              app (renderer)                        server
  │                                     │                                   │
  │── postMessage({type:"spherse:action",                                  │
  │     action:"data.get", params:{key:"score"}, requestId:"r1"})          │
  │                                     │                                   │
  │                                     │── getContent("world/game.data.json")
  │                                     │                                   │── read file
  │                                     │                               ←──│ file content
  │                                     │── JSON.parse → extract key       │
  │←── postMessage({type:"spherse:response",                               │
  │     requestId:"r1", ok:true, data:42})                                 │
```

data.get：handler 通过现有 `getContent` 读取 `.data.json` 全文，在 renderer 端解析 JSON 提取对应 key。
data.set/delete：先 `getContent` 读取 → 内存中修改 → `saveContent` 写回。复用现有 Content API，零新增 server/core 接口。

### 2.4 iframe 端使用示例

LLM skill 文档提供 Promise 封装的代码模板，iframe 内 HTML 直接复制使用：

```html
<script>
// 内嵌 Promise wrapper（由 LLM skill 文档提供）
function spherseCall(action, params) {
  return new Promise((resolve, reject) => {
    const requestId = "r" + Date.now() + Math.random().toString(36).slice(2);
    const handler = (e) => {
      if (e.data?.type === "spherse:response" && e.data.requestId === requestId) {
        window.removeEventListener("message", handler);
        e.data.ok ? resolve(e.data.data) : reject(new Error("spherse data error"));
      }
    };
    window.addEventListener("message", handler);
    window.parent.postMessage({ type: "spherse:action", action, params, requestId }, "*");
  });
}

// 使用
const score = await spherseCall("data.get", { key: "score" });
await spherseCall("data.set", { key: "score", value: 100 });
await spherseCall("data.delete", { key: "score" });
</script>
```

## 3. 架构设计

### 3.1 文件结构

```
packages/app/src/ui-sdk/
├── types.ts                          # [修改] ActionContext 新增 source、htmlPath 字段
├── handlers/
│   └── data.ts                       # [新增] data.get/set/delete handler
└── index.ts                          # [修改] side-effect import data handler

packages/presets/skills/use-ui-sdk/
└── SKILL.md                          # [修改] 新增 data action 文档
```

不新增 server route 和 core store。handler 直接复用现有 Content API（`getContent`/`saveContent`/`deleteContent`），JSON 解析与修改在 renderer 端完成。

### 3.2 调用路径

```
iframe postMessage ──→ useSpherseMessageListener ──→ dispatchAction("data.get", ...)
                                                            │
                                                            ▼
                                                     data handler
                                                            │
                                              ┌─────────────┼──────────────┐
                                              ▼             ▼              ▼
                                    ApiClient.getContent  resolvePath   postMessage
                                    (读 .data.json)     (.data.json)   response
                                              │
                                              ▼
                                        Fastify Server
                                    (现有 /api/content/*)
```

### 3.3 关键设计决策：如何确定数据文件路径

iframe 内 HTML 不知道自己对应的文件路径，需要由 app 端根据上下文推导：

| iframe 场景 | HTML 来源 | 数据文件路径推导 |
|-------------|----------|-----------------|
| Content Browser | 项目内 HTML 文件 | 从 iframe src URL 解析路径（如 `world/game.html`）→ `world/game.data.json` |
| Welcome Page | 项目内 HTML 文件 | 同上 |
| HtmlCard | 内联 HTML（srcDoc） | 若 `render_card` 有 `file_path`，从 file_path 推导；否则基于 sessionId+messageId 生成唯一路径 |

具体实现：在 `useSpherseMessageListener` 中从 `event.source` 对应的 iframe 元素的 `src` 属性解析 `htmlPath`，注入 `ActionContext`。HtmlCard 场景通过 data 属性将 `htmlPath` 传递给 iframe 元素，listener 中从 iframe 的 `dataset` 读取。

### 3.4 ActionContext 扩展

```typescript
// types.ts
export interface ActionContext {
  navigate: NavigateFunction;
  projectKey: string;
  client?: ApiClient;
  source?: MessageEventSource | null;  // [新增] postMessage 来源，用于回传响应
  htmlPath?: string;                    // [新增] 当前 iframe 对应的 HTML 文件路径
}
```

- `source`：postMessage 事件来源窗口，app 内调用时为 null
- `htmlPath`：推导出的项目内 HTML 文件路径，data handler 据此定位 `.data.json`

## 4. Data Actions

data handler 复用现有 Content API 进行 JSON 文件读写：

- `data.get`：`getContent(dataFilePath)` → `JSON.parse` → 取对应 key
- `data.set`：`getContent` 读取 → 内存中 `data[key] = value` → `saveContent` 写回
- `data.delete`：`getContent` 读取 → `delete data[key]` → `saveContent` 写回

三个 handler 共享内部 helper 函数 `readDataJson` / `writeDataJson`。

### 4.1 data.get

读取指定 key 的值。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | 要读取的 key |

响应 `data`：对应的 value（任意 JSON 类型），key 不存在时返回 `null`。

```typescript
registerAction("data.get", async (params, ctx) => {
  const { key, requestId } = params as { key: string; requestId?: string };
  if (!key || typeof key !== "string" || !requestId || !ctx.source || !ctx.htmlPath) return;

  try {
    const dataFilePath = htmlPathToDataPath(ctx.htmlPath);
    const json = await readDataJson(ctx.client!, dataFilePath);
    const value = key in json ? json[key] : null;
    ctx.source.postMessage({ type: "spherse:response", requestId, ok: true, data: value }, "*");
  } catch {
    ctx.source.postMessage({ type: "spherse:response", requestId, ok: false }, "*");
  }
});
```

### 4.2 data.set

写入 key-value，已存在的 key 覆盖。key 不存在时创建。文件不存在时自动创建。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | key 名 |
| value | any | 是 | 任意 JSON 可序列化值 |

响应 `data`：写入后的 value。

```typescript
registerAction("data.set", async (params, ctx) => {
  const { key, value, requestId } = params as { key: string; value: unknown; requestId?: string };
  if (!key || typeof key !== "string" || value === undefined || !requestId || !ctx.source || !ctx.htmlPath) return;

  try {
    const dataFilePath = htmlPathToDataPath(ctx.htmlPath);
    const json = await readDataJson(ctx.client!, dataFilePath);
    json[key] = value;
    await writeDataJson(ctx.client!, dataFilePath, json);
    ctx.source.postMessage({ type: "spherse:response", requestId, ok: true, data: value }, "*");
  } catch {
    ctx.source.postMessage({ type: "spherse:response", requestId, ok: false }, "*");
  }
});
```

### 4.3 data.delete

删除指定 key。key 不存在时也返回成功（幂等）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | 要删除的 key |

响应 `data`：`true`。

```typescript
registerAction("data.delete", async (params, ctx) => {
  const { key, requestId } = params as { key: string; requestId?: string };
  if (!key || typeof key !== "string" || !requestId || !ctx.source || !ctx.htmlPath) return;

  try {
    const dataFilePath = htmlPathToDataPath(ctx.htmlPath);
    const json = await readDataJson(ctx.client!, dataFilePath);
    delete json[key];
    await writeDataJson(ctx.client!, dataFilePath, json);
    ctx.source.postMessage({ type: "spherse:response", requestId, ok: true, data: true }, "*");
  } catch {
    ctx.source.postMessage({ type: "spherse:response", requestId, ok: false }, "*");
  }
});
```

### 4.4 内部 Helper

```typescript
function htmlPathToDataPath(htmlPath: string): string {
  return htmlPath.replace(/\.html$/, ".data.json");
}

async function readDataJson(client: ApiClient, dataFilePath: string): Promise<Record<string, unknown>> {
  const res = await client.getContent(dataFilePath);
  if (!res) return {};
  try {
    const parsed = JSON.parse(res.content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeDataJson(client: ApiClient, dataFilePath: string, data: Record<string, unknown>): Promise<void> {
  await client.saveContent(dataFilePath, JSON.stringify(data, null, 2));
}
```

## 5. 数据文件格式与路径

### 5.1 数据文件格式

`.data.json` 文件内容为顶层 JSON object，每个 key 对应一个属性：

```json
{
  "score": 100,
  "playerName": "Alice",
  "inventory": ["sword", "shield"],
  "stats": { "hp": 80, "mp": 50 }
}
```

### 5.2 路径规则

| HTML 文件路径 | 数据文件路径 |
|--------------|-------------|
| `world/game.html` | `world/game.data.json` |
| `welcome.html` | `welcome.data.json` |
| `sub/dir/page.html` | `sub/dir/page.data.json` |

路径推导：`htmlPath.replace(/\.html$/, ".data.json")`。

HtmlCard（srcDoc 内联 HTML）无对应文件时，使用同步路径：`.spherse/data/cards/{sessionId}/{messageId}.json`。

## 6. API 依赖

不新增 server 路由和 core store。data handler 复用现有 Content API：

| 操作 | 使用的现有 ApiClient 方法 | 说明 |
|------|--------------------------|------|
| 读 `.data.json` | `getContent(filePath)` | 返回 `{ content: string, path: string }`，handler 自行 `JSON.parse` |
| 写 `.data.json` | `saveContent(filePath, content)` | 写入 JSON 字符串 |
| 删 `.data.json` | `deleteContent(filePath)` | 删除整个数据文件（可选，通常不直接调用） |

- JSON 解析/修改逻辑全部在 renderer 端 handler 内完成
- server 端不做任何改动，`.data.json` 如同普通文件通过 `/api/content/*` 读写
- 路径安全由 server 端 `resolveProjectPath` 保证（现有逻辑）

## 7. 安全

### 7.1 复用现有安全机制

- **Action 白名单**：data.get/set/delete 需显式 `registerAction` 注册
- **Rate limit**：外部 postMessage 调用受每分钟 10 次限制（与现有 UI SDK 共享计数）
- **参数校验**：handler 内部校验必填参数和类型
- **路径安全**：server 端使用 `resolveProjectPath` 校验 `.data.json` 路径在项目内

### 7.2 新增安全约束

- **数据文件大小限制**：单个 `.data.json` 文件建议上限 1MB，超出时 set 操作返回错误
- **key 长度限制**：key 最长 256 字符，防止滥用
- **禁止系统路径**：`.data.json` 不能放在 `.spherse/` 目录下（但 HtmlCard 场景的 `.spherse/data/cards/` 除外）
- **跨项目隔离**：所有操作绑定到 `ActionContext.projectKey`，不跨项目

## 8. LLM Skill 更新

更新 `packages/presets/skills/use-ui-sdk/SKILL.md`，新增内容：

### 8.1 新增 Data Action 文档

- 三个 action（data.get/set/delete）的参数表和响应格式
- 数据文件路径规则说明
- 使用场景示例（游戏存档、表单草稿、状态持久化）

### 8.2 新增 Promise Wrapper 模板

提供完整的 `spherseCall()` 函数实现，LLM 可直接嵌入生成的 HTML：

```javascript
function spherseCall(action, params) {
  return new Promise((resolve, reject) => {
    const requestId = "r" + Date.now() + Math.random().toString(36).slice(2);
    const timeout = setTimeout(() => { cleanup(); reject(new Error("spherse timeout")); }, 10000);
    const handler = (e) => {
      if (e.data?.type === "spherse:response" && e.data.requestId === requestId) {
        cleanup();
        e.data.ok ? resolve(e.data.data) : reject(new Error("spherse data error"));
      }
    };
    function cleanup() { clearTimeout(timeout); window.removeEventListener("message", handler); }
    window.addEventListener("message", handler);
    window.parent.postMessage({ type: "spherse:action", action, params, requestId }, "*");
  });
}
```

## 9. E2E 验收测试

### 9.1 测试文件

在 `packages/app/e2e/` 下新建 `ui-sdk-data-crud.spec.ts`。

### 9.2 测试项目准备

创建临时项目，包含：

```
sdk-data-test.html     # 包含 data CRUD postMessage 调用的 HTML 文件
```

`sdk-data-test.html` 内容包含 get/set/delete 按钮和结果展示区域，通过 `spherseCall()` wrapper 调用 data action。

### 9.3 测试用例

**Test 1: data.set + data.get 完整链路**

1. 启动 app，在 Content Browser 中查看 `sdk-data-test.html`
2. 点击 set 按钮（set score=42），断言响应 `ok: true`
3. 点击 get 按钮（get score），断言响应 `data: 42`

**Test 2: data.get 不存在的 key 返回 null**

1. 点击 get 按钮读取未设置的 key，断言响应 `data: null`

**Test 3: data.delete**

1. set score=42 → get 确认存在 → delete score → get 确认返回 null

**Test 4: 数据持久化（刷新后恢复）**

1. set score=42 → 导航离开再回到 content browser → get score 断言仍为 42

**Test 5: data.set 复杂 JSON 类型**

1. set 存储 `{name: "Alice", items: [1,2,3]}` → get 断言返回等价对象

### 9.4 测试技术要点

- 使用 Playwright `page.frameLocator()` 与 Content Browser iframe 内元素交互
- 通过 iframe 内结果展示元素的文本内容断言 data 返回值
- 复用现有 E2E 模式：隔离临时项目 + 独立 Electron user data dir + try/finally 清理

## 10. 不做的事

- **不支持嵌套路径读写**（如 `get("player.stats.hp")`）：仅支持顶层 key 操作
- **不支持批量操作**（batch get/set）：每次请求操作一个 key
- **不支持 key 列表枚举**：不提供 list/keys 操作
- **不支持 TTL/过期**：不提供 key 过期机制
- **不修改 sandbox 配置**：现有 iframe sandbox 无需调整
- **不注入 SDK 脚本**：iframe 端保持零依赖，Promise wrapper 由 LLM 嵌入 HTML
- **不扩展 rate limit 配额**：data 操作与现有 UI SDK action 共享 10 次/分钟的限额
