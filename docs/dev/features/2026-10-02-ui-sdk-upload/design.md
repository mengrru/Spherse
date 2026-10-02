# UI SDK 文件上传 Action 设计

- 日期：2026-10-02
- 状态：草案（已经一轮 review 修订，见文末）

## 背景与目标

注入 HTML 卡片（Agent Workspace）目前没有任何向项目目录写文件的能力：`api.call` 白名单刻意只读（"Write/admin endpoints are deliberately absent"），写面仅限 `data.*` 的 `.data.json`。卡片内由用户产生或由页面生成的二进制内容（照片、录音、导出图、结构化数据）无处可去。

新增专用请求型 action `uploadFile`，把卡片内 `Blob` 落盘到项目目录。复用既有 `POST /api/projects/:projectId/upload/*` 路由（文件树拖拽上传同路径），**server 与 core 零改动**。

## 已确认的产品决策

1. 暂时限制可上传格式为**常见图片 / 音频 / 视频 + `txt` / `json` / `md`**（扩展名白名单，大小写不敏感）
2. 其余行为对齐文件树拖拽上传：单文件上限 100MB、服务端同名自动去重、响应 `{ path, bytes, renamed }`

## 决策

| 决策点 | 结论 |
|---|---|
| API 形态 | 专用请求型 action `uploadFile`（遵守 `handlers/api.ts:5-11` 设计约束：写操作走专用 action，不扩 `api.call` 白名单）。SDK 侧 `spherse.uploadFile(params): Promise<{ path, bytes, renamed }>`，`params = { dirPath?: string; name?: string; data: Blob \| File }`：`data` 必填（File 自带 `name` 时 `name` 可省，Blob 必给 `name`）；`dirPath` 省略 = 项目根 |
| 数据传输 | `Blob`/`File` 随 `spherse:action` params 直接 postMessage——结构化克隆原生支持，无 base64 体积膨胀，host 侧 `event.data.params.data` 即原对象 |
| 超时 | `call()` 默认 10s 对大文件太短；`uploadFile` 显式传 `timeoutMs = 60_000`（本地回环 100MB 秒级完成，60s 余量充足；`call` 已支持第三参，无需改 messaging） |
| 格式白名单 | host handler 强制（权威边界），SDK 侧不重复校验避免清单漂移。大小写不敏感比较扩展名：图片 `png jpg jpeg gif webp svg bmp avif ico`；音频 `mp3 wav ogg m4a flac aac opus`；视频 `mp4 webm mov avi mkv`；文本 `txt json md`。未命中 → `unsupported_type`。svg 放行：聊天卡片与 Content Browser 均按 `<img>` 渲染 svg（脚本不执行），且文件树 DnD 上传本无文件名白名单，server 面无增量 |
| dirPath 校验 | **先严格校验再比较**，不做 basename/normalize 改写：(a) trim 后空串 = 根；(b) 拒绝以 `/` 开头（绝对路径）与含 `\` 的 `dirPath`；(c) 按 `/` 拆段，任一段为 `..` 或 `.` → 拒绝（封死 `foo/../.spherse/skills` 逃逸——server 端 `SRV_WRITE` 含 skills/agentSkills/attachments，归一化后不兜底）；(d) 大小写不敏感比较首段：lowercase 为 `.spherse` → `forbidden`（macOS APFS 大小写不敏感，`.Spherse` 实际落到 `.spherse`）。非法形态（b）（c）→ `bad_request`。SDK 入口不暴露内部状态目录，尽管 server 路由本身允许写这些位置 |
| 文件名安全 | host 侧预检 `name`（reject 而非 rewrite）：trim → 非空、不含 `/` `\` `:`（复用 `tree-model.ts:24` 导出的 `INVALID_NAME_RE`，同包直引）→ 否则 `bad_request`；扩展名白名单校验的对象**永远是最终上传的文件名**（见下条），杜绝 `name: "ok.png"` + `File("evil.html")` 的校验脱钩；server 侧 sanitize 与去重不变（权威） |
| Blob→File 衔接 | `resolvedName = trim(params.name ?? (data instanceof File ? data.name : ""))`；校验通过后 `file = data instanceof File && data.name === resolvedName ? data : new File([data], resolvedName)`（File 构造器持 Blob 引用不复制底层数据），传 `ctx.client.uploadFile(dirPath, file)`（`api.ts:584` 既有签名收 `File`，`api.ts` 零改动） |
| 大小限制 | host 侧预检 `data.size > 100MB` → `file_too_large`（快速失败，免传整包后才被 server 拒）；server 100MB 上限不变 |
| 宿主边界 | web 宿主（`ctx.hostKind !== "electron"`）→ `forbidden`：web 端 `capabilities.content.editable = false`，文件树上传以 `uploadsEnabled={canMutate}` 关闭，SDK 入口不绕过该产品边界（判 `hostKind` 是 float 降级的既有模式；若未来 desktop 出现 readOnly 模式需改判 capability，记入已知限制） |
| 错误码 | `bad_request`（参数缺失/类型错/dirPath 非法形态/文件名非法/缺 client）、`unsupported_type`、`file_too_large`、`forbidden`（`.spherse` 子树或 web 宿主）、`upload_failed`（server 4xx/5xx 兜底，含目标目录不存在等）。成功 resolve `uploadResponse` 契约形状 |
| 成功副作用 | `invalidateProjectFileQueries(projectId, res.path)` 刷新文件树与目录查询（与 `useFileTreeController` 上传后一致）；订阅 `file:update` 的 iframe 由 bus fs-watch 自然收到事件，无需额外广播 |
| 限流 | 不进 `RATE_LIMIT_WHITELIST`，占用 30 次 / 60s 全局配额（与 `data.set` / `api.call` 同待遇，写操作应计数）。被限流丢弃时 SDK 侧表现为 60s 超时（见已知限制） |
| SDK 类型 | `UploadFileParams` / `UploadFileResult` 声明于 `sdk/src/runtime/actions.ts`（sdk 零运行时依赖，不引 `@spherse/contracts`，类型字面镜像 `uploadResponse`） |
| SDK_VERSION | 保持 `"1"`：additive 变更；旧 host 收到未知 action 仅 console.warn 不 respond，新 SDK 在旧 host 上表现为超时（既有兼容行为） |
| UI 反馈 | 不加 toast——上传结果以 response 返回，由卡片自行决定 UX（进度条 / 提示）；文件树刷新即结果可见 |
| i18n | 无用户可见文案，无 i18n 变更 |
| 磁盘填充面 | 接受：限流上限 30 次/60s × 100MB ≈ 3GB/min 理论上界，无用户手势可持续——本地单用户应用、卡片内容本身处于 agent 信任模型内（agent 已可经工具写项目），不额外加约束；记入已知限制 |

## 契约

```
iframe → host:  { type: "spherse:action", action: "uploadFile",
                  params: { dirPath?, name?, data: Blob | File }, requestId }
host → iframe:  { type: "spherse:response", requestId, ok: true,
                  data: { path: string, bytes: number, renamed: boolean } }   // uploadResponse 复用
                | { ..., ok: false, data: { error: "bad_request" | "unsupported_type"
                                           | "file_too_large" | "forbidden" | "upload_failed" } }
```

## 影响面

- `packages/sdk/src/runtime/actions.ts`：`uploadFile` action + `UploadFileParams` / `UploadFileResult` 类型
- `packages/app/src/ui-sdk/handlers/upload-file.ts`（新增）：参数校验、白名单、`ctx.client.uploadFile` 调用、成功后 invalidate
- `packages/app/src/ui-sdk/index.ts`：barrel 补 import
- 文档：`packages/presets/skills/spherse-use-ui-sdk/SKILL.md`（新 API 章节）、`docs/official/architecture/ui-sdk.md`（API 面与 handler 一览表；L41「静默丢弃表现为 10s 超时」表述随 60s 超时更新）、`docs/official/project-structure.md`（`handlers/` 文件粒度清单补 `upload-file.ts`）
- server / core / contracts / `app/src/lib/api.ts`：零改动

## 测试

- sdk `actions.test.ts` 补：`uploadFile` 透传 Blob 参数与 60s 超时
- app `handlers/upload-file.test.ts`（新增，mock ApiClient，不 mock 被测 handler）：
  - 成功：File 与 Blob+name 两种入参 → respond ok + `{ path, bytes, renamed }`；`invalidateProjectFileQueries` 以最终 path 调用
  - `data` 非 Blob / Blob 缺 name → `bad_request`
  - 扩展名不在白名单（`.exe`、`.html`、无扩展名）→ `unsupported_type`；大小写不敏感放行（`.PNG`）
  - `name` 显式给定且与 File.name 不同 → 上传用校验后的 `name`（防脱钩）
  - `size` 超 100MB → `file_too_large`
  - `dirPath` 指向 `.spherse` 子树（含 `foo/../.spherse/skills`、`.Spherse` 大小写变体）→ `forbidden` / `bad_request`
  - `dirPath` 绝对路径 / 含 `\` / 含 `..` 段 → `bad_request`
  - `name` 含路径分隔符（`a/b.png`）→ `bad_request`（reject 不改写）
  - `hostKind: "web"` → `forbidden`
  - client 为 null / `uploadFile` reject → `bad_request` / `upload_failed`
- 手工验证：desktop 卡片内 `spherse.uploadFile` 上传图片到子目录，文件树即时刷新、同名去重、订阅 `file:update` 收到事件；web 端卡片调用返回 `forbidden`

## 已知限制

- 白名单为产品约束而非安全边界——扩展名不校验内容（伪 png 可上传）；深层安全由 server 访问策略 + 写互斥兜底
- 无上传进度（fetch 无进度回调，与文件树上传已知限制同源）；本地回环可接受
- 被限流丢弃时卡片侧表现为 60s 超时而非明确错误（既有静默丢弃行为，跨 action 统一，不单独改）
- 旧 host + 新 SDK：action 不可用同样表现为 60s 超时，依赖宿主随应用升级
- 磁盘填充理论上界 ~3GB/min（见决策表），接受
- 宿主边界判 `hostKind` 而非 capability：未来 desktop 若出现 readOnly 模式需改为判 `capabilities.content.editable`
- 上传 dotfile 成功但文件树过滤 dotfile 不可见（既有规则；白名单无 dotfile 扩展名，实际不可达）

## Review 修订记录

2026-10-02 首轮 review（sub agent）后修订：

- **critical**：`.spherse` 收窄原为字面前缀检查，可被 `foo/../.spherse/skills`（server 归一化后落 SRV_WRITE 白名单目录）与 `.Spherse`（APFS 大小写不敏感）绕过 → 改为严格 dirPath 校验（禁 `..`/`.` 段、绝对路径、反斜杠 + 大小写不敏感首段比较）
- **important**：Blob→`client.uploadFile` 衔接未指定（FormData 对裸 Blob 默认 filename `"blob"`）→ 明确 `new File([data], resolvedName)` 包装与 name 脱钩防护；web 宿主绕过 `content.editable` 边界 → `hostKind` 判定拒绝；文档同步缺 project-structure.md → 补
- **medium**：磁盘填充面显式评估并接受；限流 × 超时交互（120s→60s 并记录）；name 校验 reject/rewrite 矛盾 → 统一 reject
- **minor**：`INVALID_NAME_RE` 同包直引不复制；name 预检补 trim 对齐 server
