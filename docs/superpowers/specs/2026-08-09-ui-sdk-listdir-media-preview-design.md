# UI SDK listDir + 媒体 Preview + 只读扩展接口

## 背景

当前 UI SDK 和 Preview API 的能力边界：

- **Preview API**（`packages/server/src/routes/preview.ts`）：仅服务 web-safe 格式（html/css/js/json/images/fonts）。不含任何音视频 MIME 类型，用户 HTML 中 `<audio src="music.mp3">` 或 `<video src="clip.mp4">` 无法播放。
- **UI SDK `api.*`** 只读 HTTP bridge 白名单：`agents.list/get`、`sessions.list/messages/status`、`content.get`、`fileTree`。`fileTree` 返回**全项目**文件路径的扁平 `string[]`（重量级，无法列单个目录）。`content.get` 面向文件内容读取，不适配目录。
- **`data.*`** key-value 接口只有 `get/set/delete` 单 key 操作，无法枚举已有 key。
- 服务端 content GET route（`content.ts:47-53`）**已经**对目录返回 `{name, type}[]`，且 `ApiClient.listContent()`（`api.ts:137-146`）已存在——只是没接入 SDK 白名单。

## 目标

1. **`listDir`**：SDK 可列出单个项目目录的内容
2. **媒体 Preview**：Preview API 服务音视频文件（mp3/mp4 等），支持 Range 请求（seek/scrub）
3. **只读扩展接口（Tier 1）**：
   - `data.keys(file)` — 列出数据文件所有 key
   - `data.entries(file)` — 获取数据文件全部 key-value 对
   - `content.stat(path)` — 获取文件/目录元信息（size / mtime / isDirectory）

## 详细设计

### 1. `content.listDir` — 目录列表

#### SDK 侧（`packages/sdk/src/runtime/api.ts`）

`content` 命名空间新增 `listDir`：

```ts
content: {
  get: (filePath: string): Promise<unknown> => apiCall("content.get", { path: filePath }),
  listDir: (dirPath: string): Promise<unknown> => apiCall("content.listDir", { path: dirPath }),
},
```

#### Host 侧（`packages/app/src/ui-sdk/handlers/api.ts`）

ALLOWLIST 新增一行，复用已有的 `ApiClient.listContent()`：

```ts
"content.listDir": (c, a) => c.listContent(str(a.path)),
```

无需新增 ApiClient 方法或 server route——`listContent` 已调用 `GET /content/{path}` 并解析 `fileEntries` schema。

#### 返回值

```ts
{ name: string, type: "file" | "directory" }[]
```

与 server content route 的目录响应一致。dotfiles / node_modules / .spherse 由 `shouldSkipDirEntry` 过滤（file-tree route 现有行为）。空目录返回 `[]`。

#### Rate limiting

`api.call` 受 30 次/分钟限制（与现有 op 一致），不加入白名单。目录列表不是高频操作。

---

### 2. 媒体格式 + Range 请求（Preview API）

#### MIME 类型扩展（`packages/server/src/routes/preview.ts`）

`CONTENT_TYPES` 新增：

| 扩展名 | MIME |
|--------|------|
| mp3 | audio/mpeg |
| wav | audio/wav |
| ogg | audio/ogg |
| oga | audio/ogg |
| flac | audio/flac |
| m4a | audio/mp4 |
| aac | audio/aac |
| opus | audio/opus |
| mp4 | video/mp4 |
| m4v | video/mp4 |
| webm | video/webm |
| mov | video/quicktime |
| ogv | video/ogg |
| avi | video/x-msvideo |
| mkv | video/x-matroska |

#### Range 请求支持

当前 `handlePreview` 对所有请求 `fs.readFile` 整个文件后 `reply.send(buffer)`。新增 Range 处理：

1. **所有 binary 响应**（非 HTML）附带 `Accept-Ranges: bytes` header，向客户端声明支持 Range
2. 当请求携带 `Range: bytes=start-end` header 时：
   - 解析 range（支持 `bytes=start-end`、`bytes=start-`、`bytes=-suffix` 三种标准形式）
   - `fs.open` + `handle.read(buffer, 0, length, start)` 读取请求范围的字节
   - 返回 `206 Partial Content`，header：
     - `Content-Range: bytes {start}-{end}/{totalSize}`
     - `Content-Length: {rangeLength}`
     - `Accept-Ranges: bytes`
     - `Cache-Control: no-cache`
     - `ETag`（复用现有 etag 逻辑）
3. 无 Range header 时，行为不变（200 + 完整文件），但所有 binary 响应都加 `Accept-Ranges: bytes`
4. HTML 文件不做 Range 处理（需要 SDK 注入，整体语义不同）
5. `__spherse-sdk.js` 不做 Range 处理（短路返回 source）

#### 实现结构

```
handlePreview:
  ├── SDK_FILENAME 短路 → 返回 source（无 Range）
  ├── access policy 校验
  ├── ext 白名单校验
  ├── fs.stat
  ├── etag / 304 检查
  ├── isHtml? → 注入 SDK → send（无 Range）
  └── binary file:
      ├── 有 Range header → 解析 → 206 Partial Content
      └── 无 Range header → send 完整 buffer + Accept-Ranges: bytes
```

#### Range 解析规则

- `bytes=0-499` → start=0, end=499
- `bytes=500-` → start=500, end=fileSize-1
- `bytes=-500` → start=fileSize-500, end=fileSize-1（最后 500 字节）
- 非法 range（越界、start > end）→ 忽略 Range header，返回 200 完整内容（标准 HTTP 行为）
- 仅支持单个 range（不解析 `bytes=0-100,200-300` 多段 range；浏览器不发多段）

---

### 3. `data.keys` / `data.entries` — 数据文件枚举

#### SDK 侧（`packages/sdk/src/runtime/data.ts`）

```ts
export const data = {
  get: (params: Params): Promise<unknown> => call("data.get", params),
  set: (params: Params): Promise<unknown> => call("data.set", params),
  delete: (params: Params): Promise<unknown> => call("data.delete", params),
  keys: (params: Params): Promise<unknown> => call("data.keys", params),
  entries: (params: Params): Promise<unknown> => call("data.entries", params),
};
```

#### Host 侧（`packages/app/src/ui-sdk/handlers/data.ts`）

复用 `validateFileParam` + `readDataJson`，新增两个 handler：

```ts
// data.keys — 返回所有顶层 key
registerAction("data.keys", async (params, ctx) => {
  const { file } = params as { file: unknown };
  const validFile = validateFileParam(file);
  if (!validFile || !ctx.client) return;
  try {
    const json = await readDataJson(ctx.client, validFile);
    respond(ctx, true, Object.keys(json));
  } catch {
    respond(ctx, false);
  }
});

// data.entries — 返回全部 key-value 对象
registerAction("data.entries", async (params, ctx) => {
  const { file } = params as { file: unknown };
  const validFile = validateFileParam(file);
  if (!validFile || !ctx.client) return;
  try {
    const json = await readDataJson(ctx.client, validFile);
    respond(ctx, true, json);
  } catch {
    respond(ctx, false);
  }
});
```

文件不存在或 JSON 解析失败时：`keys` 返回 `[]`，`entries` 返回 `{}`（`readDataJson` 的 fallback 行为）。

#### Rate limiting

`data.keys` 和 `data.entries` 与 `data.get` 成本相同（都读整个文件并 parse），加入 `RATE_LIMIT_WHITELIST`：

```ts
export const RATE_LIMIT_WHITELIST = new Set(["data.get", "data.keys", "data.entries"]);
```

---

### 4. `content.stat` — 文件元信息

#### Server route（`packages/server/src/routes/content.ts`）

新增 `GET /api/projects/:projectId/stat/*` route：

```ts
fastify.get<{ Params: { projectId: string; "*": string } }>(
  "/api/projects/:projectId/stat/*",
  { schema: { response: { 200: schemas.statResponse } } },
  async (req) => {
    const relativePath = req.params["*"];
    const root = req.projectCtx!.projectManager.getRootPath();
    const policy = serverAccessPolicy(root);
    try { policy.assertRead(relativePath); }
    catch (err) {
      if (err instanceof AccessDeniedError) throw forbidden("Access denied");
      throw err;
    }
    const absolutePath = resolveProjectPath(root, relativePath);
    let stat;
    try { stat = await fs.stat(absolutePath); }
    catch { throw notFound("Not found"); }
    return {
      size: stat.size,
      mtime: stat.mtimeMs,
      isDirectory: stat.isDirectory(),
    };
  },
);
```

#### Contract（`packages/server/src/contracts/content.ts`）

```ts
const statResponse = Type.Object({
  size: Type.Number(),
  mtime: Type.Number(),
  isDirectory: Type.Boolean(),
});
```

#### ApiClient（`packages/app/src/lib/api.ts`）

`apiBase` = `${baseUrl}/api/projects/${projectId}`（与 `getContent` 的 `${apiBase}/content/{path}` 同级）：

```ts
async stat(filePath: string): Promise<{ size: number; mtime: number; isDirectory: boolean }> {
  const res = await authedFetch(`${apiBase}/stat/${encodeURIComponent(filePath)}`);
  await assertOk(res);
  return parseJsonResponse(res, schemas.statResponse);
}
```

#### SDK 侧（`packages/sdk/src/runtime/api.ts`）

```ts
content: {
  get: (filePath: string): Promise<unknown> => apiCall("content.get", { path: filePath }),
  listDir: (dirPath: string): Promise<unknown> => apiCall("content.listDir", { path: dirPath }),
  stat: (filePath: string): Promise<unknown> => apiCall("content.stat", { path: filePath }),
},
```

#### Host 侧（`handlers/api.ts`）

```ts
"content.stat": (c, a) => c.stat(str(a.path)),
```

#### Rate limiting

`api.call` 受 30 次/分钟限制，不加入白名单。

---

## 涉及文件总览

| 文件 | 变更 |
|------|------|
| `packages/server/src/routes/preview.ts` | 媒体 MIME 类型 + Range 请求处理 |
| `packages/server/src/routes/content.ts` | 新增 `GET /stat/*` route |
| `packages/server/src/contracts/content.ts` | 新增 `statResponse` schema + export |
| `packages/app/src/lib/api.ts` | 新增 `stat()` 方法 |
| `packages/app/src/ui-sdk/handlers/api.ts` | ALLOWLIST 新增 `content.listDir` + `content.stat` |
| `packages/app/src/ui-sdk/handlers/data.ts` | 新增 `data.keys` + `data.entries` handler |
| `packages/app/src/ui-sdk/rate-limit.ts` | `RATE_LIMIT_WHITELIST` 新增 `data.keys`、`data.entries` |
| `packages/sdk/src/runtime/api.ts` | `content` 命名空间新增 `listDir` + `stat` |
| `packages/sdk/src/runtime/data.ts` | 新增 `keys` + `entries` |
| `packages/sdk/dist/browser.js` | esbuild 重新打包 |
| `packages/presets/skills/use-ui-sdk/SKILL.md` | 文档更新（API 总览表 + 各方法说明 + 示例） |

### 测试

| 测试文件 | 覆盖 |
|---------|------|
| `packages/server/src/__tests__/preview.test.ts` | 媒体 MIME 类型 + Range 请求 206 / 不带 Range 200 |
| `packages/server/src/__tests__/content.test.ts`（新增或补充） | `stat/*` route 正常 + 404 + 403 |
| `packages/app/src/ui-sdk/handlers/api.test.ts` | `content.listDir` + `content.stat` op |
| `packages/app/src/ui-sdk/handlers/data.test.ts`（新增或补充） | `data.keys` + `data.entries` |
| `packages/app/src/ui-sdk/rate-limit.test.ts` | whitelist 包含 `data.keys`、`data.entries` |
| `packages/desktop/e2e/ui-sdk-bridge.spec.ts` | E2E：listDir / stat / data.keys / data.entries 经 SDK 桥接可调 |

### 文档维护

- `docs/official/architecture.md` — UI SDK 段落更新白名单 + data 接口
- `docs/dev/backlog.md` — 新增条目并标记完成

## 不做的事（YAGNI）

- **`content.save` / 任意文件写入**：与 agent write_file 重叠，写权限需独立设计
- **clipboard / theme / notifications**：Tier 2/3，价值不匹配复杂度
- **多段 Range 请求**：浏览器不发，YAGNI
- **`listDir` 递归**：用 `fileTree()` 获取全量；单目录列表保持扁平
