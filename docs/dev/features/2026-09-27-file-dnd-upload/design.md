# File Panel 拖拽上传（Drag & Drop Upload）设计

- 日期：2026-09-27
- 状态：已实施

## 背景与目标

File panel（用户文件树）目前只能通过右键菜单新建文件/文件夹，无法把系统文件拷贝进项目。新增拖拽上传：

- 从系统拖文件到 file panel，落到**鼠标悬停的文件夹行**内；拖到面板空白处落到项目根目录
- 仅支持单文件粒度（不解析/递归文件夹）；一次拖入多个文件时全部上传，文件夹条目忽略
- 上传走后端 API（multipart HTTP），为未来 server 云端部署保留同一路径

## 已确认的产品决策

1. 目标文件夹已有同名文件时**服务端自动重命名** `name (1).ext`、`name (2).ext`……，不弹确认
2. 单文件上限 **100MB**（超限报错；现有聊天图片 5MB 业务校验不变）
3. 多文件（非文件夹）全部上传
4. 面板空白处（不悬停任何文件夹行）= 上传到项目根目录

## 决策

| 决策点 | 结论 |
|---|---|
| API 形态 | `POST /api/projects/:projectId/upload/*`，`*` 为目标目录相对路径（空串 = 根目录，与 `content/*` 的调用约定一致）。multipart 单字段 `file`，一请求一文件；文件名取 `part.filename`。响应 `{ path, bytes, renamed }`，`path` 为去重后的最终相对路径 |
| 大小限制 | upload route 业务上限 `MAX_UPLOAD_BYTES = 100MB`，通过 `req.parts({ limits: { fileSize: MAX } })` **per-route** 生效（@fastify/multipart 9 的 `parts(options)` 支持）；**全局 multipart 5MB 配置不变**，attachments 行为与其测试环境完全不受影响。超限（`FST_REQ_FILE_TOO_LARGE` / 显式检查）→ 400 "File too large" |
| 文件名安全 | `basename()` 归一后校验不含 `/` `\` `:`、非空（server route 本地常量，renderer 的 `INVALID_NAME_RE` 跨包不可引，规则保持字面一致），非法名 → 400。文件名本身不做白名单（dotfile 允许，与树的可视性规则解耦，见已知限制） |
| 去重逻辑 | 纯函数 `dedupeFileName(existing: ReadonlySet<string>, filename: string): string` 定义并导出于 server route 文件（`name.ext` → `name (1).ext`，无扩展名 → `name (1)`）。冲突比较**大小写不敏感**（existing 名小写化建集合）：macOS APFS 默认大小写不敏感，大小写敏感比较会静默覆盖 `Foo.txt`/`foo.txt`；代价是 Linux 上仅大小写不同的两个文件会被多余重命名，可接受（防数据丢失优先），保留拖入名原始大小写。route 内 `fs.readdir` 目标目录一次取现有名集合计算候选名，实际写入走 `pm.writeBinaryFile`（自带 access policy 断言 + 写互斥 + 自动建父目录）。并发上传理论上有 TOCTOU 窗口，本地单用户场景接受（客户端同批顺序上传） |
| 目标目录校验 | route 先 `fs.stat` 确认目标存在且为目录，不存在 → 404，非目录 → 400（`readdir` 阶段目录被并发删除同样映射 404）；写入被 access policy 拒绝的路径（如 `.spherse` 顶层、`spherseOther` 类别）→ `AccessDeniedError` 映射 403。注：policy 的 `SRV_WRITE` 实际允许 `skills`/`attachments` 等类别写入 `.spherse` 子树，但本功能不在这些位置暴露入口（见下条） |
| DnD 能力注入 | `FileTree` 新增可选布尔 prop `uploadsEnabled`（实现时由设计初稿的 `onDropFiles` 回调简化而来：回调形态与控制器内部编排重复，布尔开关效果等价且更简单），context 下发 `dropFiles: ctrl.uploadFiles | undefined`；**只有 UserFilePanel 传入**。skill panel 等其他 FileTree 消费方不传 → 完全无拖拽行为（`.spherse/skills` 树不获得上传入口）。`readOnly` 时不挂任何 drag handler（web 端天然不可用）。根空白 drop 的目标目录 = FileTree 的 `basePath`（`rootPath ?? ""`），对 UserFilePanel 即项目根 |
| 文件行落点 | 拖到**文件行**上 = 上传到该文件所在目录（`parentDirPath`），与直觉一致（文件落在所悬停文件旁边）；行为与文件夹行/空白处统一高亮 |
| Contract | 新域文件 `packages/contracts/src/upload.ts`：`uploadResponse` schema + `Static` 类型，`index.ts` 聚合导出。multipart body 不绑 Fastify schema（attachments 先例；其响应 schema 现居 client 本地，本功能按 AGENTS.md 契约红线放进 contracts） |
| API client | `api.ts` 新增 `uploadFile(dirPath: string, file: File)`：FormData append `file`，POST `${apiBase}/upload/${encodeURIComponent(dirPath)}`，`authedFetch` 不手设 Content-Type，响应过 `uploadResponse` parser |
| 上传编排 | `useFileTreeController` 新增 `uploadFiles(dirPath, files)`：顺序逐个 `client.uploadFile`（避免本地磁盘写竞争），单文件失败 toast 并继续，结束后对每个成功 path `invalidateProjectFileQueries` + `expandDir(dirPath)` 让结果立即可见 |
| 拖放 UI | `DirectoryNode` 的 `CollapsibleTrigger`（TreeRow）、`FileRow`（TreeRow）与 `FileTree` 根容器（空白处，仅当传入 `uploadsEnabled`）挂 `onDragOver`/`onDragLeave`/`onDrop`：`dataTransfer.types` 含 `Files` 才响应，`preventDefault()` + `dropEffect = "copy"`；高亮态为 FileTree 根组件持有的**单一共享状态** `dropTargetDir: string \| null`（经 context 下发，行高亮 = `dropTargetDir === item.path`，根容器 = `=== basePath`），任一时刻至多一个激活目标，从根上杜绝「激活态残留」 |
| 事件包含关系 | 目录/文件行 handler 对 `dragover`/`drop`/`dragleave` 一律 `stopPropagation()`：行是根容器后代，不阻断则一次 drop 冒泡到根容器导致同一批文件上传两次（目标目录 + 根目录）。行 `dragover` 置 `dropTargetDir = item.path`（覆盖根容器值），行 `dragleave` 仅在 `prev === item.path` 时自清（防相邻行切换的事件乱序误清），根容器 `dragleave` 在 `relatedTarget` 离开容器时无条件清空（兜底行 stopPropagation 后根容器收不到 dragleave 的路径）。最初实现的三个局部布尔 state 存在「根容器激活后在行上 drop → 根容器高亮永久残留」缺陷，改为共享单一状态修复 |
| 文件夹过滤 | drop handler **同步**快照 `dataTransfer.items` 的 `webkitGetAsEntry()` 结果（items 在让出事件循环后失效，须先取后 await）：`entry.isDirectory` 条目忽略；entry API 不可用时 fallback `dataTransfer.files` |
| 窗口级兜底 | app 共享入口（desktop 与 web 均生效）挂 window `dragover`/`drop` `preventDefault()`（仅当 `types` 含 `Files`）：防止拖到无 handler 区域时 Electron 窗口导航到 `file://` 白屏；web 端此门控下无副作用 |
| 上传反馈 | 成功 toast `file-tree.uploadedCount` {count}；任一文件被服务端重命名时追加 info toast `file-tree.uploadedRenamed` {names}（逗号连接，超过 5 个截断加 `…`）；失败 toast `file-tree.uploadFailed` {message}（沿用 `createFailed`/`deleteFailed` 模式）；拖入内容全部为文件夹（无可上传文件）时 info toast `file-tree.uploadNoFiles`。zh-CN / zh-TW / en |
| E2E | 现有 desktop E2E 无 file-tree 上传场景覆盖，本功能不新增 E2E（拖拽系统文件需 OS 级 DnD 合成，Playwright `DataTransfer` 可行但投入产出低），以 server route 真 PM 测试 + 手工验证覆盖 |

## 契约

```
POST /api/projects/:projectId/upload/*        (multipart/form-data, field "file")
→ 200 { path: string, bytes: number, renamed: boolean }
```

## 影响面

- `packages/contracts/src/upload.ts`（新增）、`src/index.ts`、`src/__tests__/api-contracts.test.ts`
- `packages/server/src/routes/upload.ts`（新增）、`src/routes/index.ts`、`src/__tests__/upload.test.ts`（新增）
- `packages/app/src/lib/api.ts`（`uploadFile`）、`src/components/file-tree/index.tsx`（根 drop zone + `uploadsEnabled` prop）、`file-tree-context.tsx`（context 字段）、`FileTreeNode.tsx`（目录行与文件行 drop target）、`hooks/useFileTreeController.ts`（`uploadFiles`）、`dnd.ts`（新增，拖拽提取纯函数）、`src/main.tsx`（window 兜底）、`src/features/user-file-panel/index.tsx`（注入 `uploadsEnabled`）
- `packages/i18n`：4 个新 key × 3 locale

## 测试

- server `upload.test.ts`（真 Fastify + 真 ProjectManager 临时目录，不 mock 被测写入门面，满足跨层契约测试红线）：
  - 上传到根目录 / 子目录，落盘内容与响应 `{ path, bytes, renamed }` 正确
  - 同名自动重命名：一次冲突、多次冲突、无扩展名文件、大小写不同名冲突（case-insensitive 防覆盖）
  - filename 含路径（`../../evil.txt`）→ 归一为 basename
  - 目标目录不存在 → 404；目标是文件 → 400；缺 file 字段 → 400；`readdir` 时目录被删 → 404
  - `.spherse/` 顶层目标 → 403
  - per-route 限流回归：6MB（超全局 5MB）成功；100MB+1 字节 → 400
- contracts `api-contracts.test.ts`：`uploadResponse` 正/负样本
- app `useFileTreeController` 测试（新增 hooks 测试基线）：上传成功路径 invalidate 与 expandDir 调用、失败 toast、重命名名单 toast、空列表提示
- app `dnd.test.ts`：`hasFileDrag` / `extractDroppedFiles`（目录条目过滤、entry API 缺失 fallback）
- app `drag-highlight.test.tsx`：拖放高亮状态机（根容器激活 → 行接管不残留、行 drop 后全清、拖离面板清除、容器内移动保持、空白 drop 上传根目录）
- 手工验证：桌面端拖单文件/多文件/文件夹（忽略）到文件夹行、文件行与空白处、web 端 readOnly 不响应、skill panel 无拖拽行为

## 已知限制

- 不支持拖入文件夹（含其内容），需求明确排除
- 大文件上传无进度条（fetch 无上传进度），100MB 内本地回环感知可接受
- 上传 dotfile 成功但文件树过滤 dotfile 不可见（`buildTreeItems` 既有规则），与手动新建 dotfile 行为一致
- Linux 大小写敏感文件系统上传仅大小写不同的同名文件会被多余重命名（防覆盖的代价，见决策）
