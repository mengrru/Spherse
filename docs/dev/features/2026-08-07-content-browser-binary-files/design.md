# Content Browser 二进制文件拦截与外部打开

> 日期：2026-08-07
> 范围：Content Browser 打开 PDF / Word / 音视频 / 压缩包等无法在应用内渲染的二进制文件时，不再以 UTF-8 强解出乱码，而是显示占位卡并提供「用默认应用打开」按钮。

## 背景

Content Browser 目前只识别三类（`packages/app/src/features/content-browser/index.tsx:61-68` 与 `FloatingContentBrowserContainer.tsx:16-22` 重复一份）：markdown（`md`/`markdown`/`*.agents.md`）、html（`html`/`htm`）、image（`png`/`jpg`/`jpeg`/`gif`/`svg`/`webp`）。其余所有扩展名一律落到 `ContentView.tsx:134` 的 `<pre>` 分支，内容由 `GET /content/*` 以 `fs.readFile(path, "utf-8")` 读取（`packages/server/src/routes/content.ts:40`）。

后果：PDF / Word / MP3 / MP4 / zip 等二进制文件被当成 UTF-8 文本解码，渲染成一屏乱码替换字符，且**整个文件被读进内存**。另外「用其它软件打开」也做不到——`shell.openPath` 仅有一个开**项目目录**的 handler（`packages/desktop/electron/ipc/project.ts:64-66`），`shell.openExternal` 被 `http(s)/mailto/tel` 协议白名单锁死（`:68-86`），没有 per-file 的 IPC，也没有 `shell.showItemInFolder`。

本次只做：白名单 + 启发式拦截二进制文件，并提供桌面端「用默认应用打开」。**不做**内置 PDF / 视频查看器。

## 决策摘要

| 议题 | 决策 |
|---|---|
| 二进制检测 | **方案 A**：服务端在 content 路由读头 8KB，复用 core 的 `isBinaryBuffer` null-byte 启发式，结果写入响应体 |
| 白名单语义 | 白名单只覆盖需要专属 viewer 的三类（md/html/image）；其余文件全部走「嗅探 → 文本是则放行 `<pre>`、二进制则拦截」 |
| 无扩展名 / 点文件 | **不**单独维护文件名清单（Makefile/.gitignore 等）。这类文件本就是文本，启发式自动放行 `<pre>`，结果一致且少一份要维护的清单 |
| other 文本渲染 | 保持现有 `<pre>` 不变（markdown 渲染器无语法高亮插件，裸喂会破坏代码文件） |
| 外部打开动作 | 仅「用默认应用打开」（`shell.openPath`），桌面专用；web 版占位卡只显示文案、不显示按钮 |
| 嗅探可靠性 | null-byte 启发式非 100%（UTF-16 文本会误判、长 ASCII 头二进制会漏判），但白名单 + 启发式组合下：白名单内 100% 确定性渲染，白名单外由启发式放行文本，足够覆盖目标格式 |

## 分类与数据流

客户端按 `filePath` 计算 `kind`，纯函数（无 IO）：

```
kind = markdown | html | image | other
  markdown: md, markdown, *.agents.md
  html:     html, htm
  image:    png, jpg, jpeg, gif, svg, webp, ico   ← 新增 ico，对齐 preview 路由白名单
  other:    其余一切（无扩展名 / 点文件 / 未知扩展名）
```

渲染分流（`ContentView.tsx`）：

- `markdown` → `getContent` → `<MarkdownContent variant="document">`（按白名单信任为文本）
- `html` → preview URL `<iframe>`（不变）
- `image` → preview URL `<img>`（不变）
- `other` → `getContent` → 读响应 `binary` 标志：
  - `binary: true` → `<UnsupportedFileCard>` 占位卡
  - 否则 → 现有 `<pre>`（不变）

两处入口（主 ContentBrowser 与 FloatingContentBrowserContainer）共用 `ContentView`，自动获得占位卡行为；`detectFileKinds` 同步加上 `ico`。

## 服务端变更

### 契约（`packages/server/src/contracts/content.ts`）

纯加字段，向后兼容（旧 client 不读 `binary`，旧 server 不返回时 client 视作 `false`）：

```ts
contentResponse: Type.Object({
  content: Type.String(),
  path: Type.String(),
  binary: Type.Optional(Type.Boolean()),
})
```

### content 路由 GET（`packages/server/src/routes/content.ts`）

仅改文件分支（目录分支 `:32-38` 不动）：

```ts
// 读头 8KB 做二进制嗅探（用 fs.open + read，不读全文件）
const fd = await fs.open(absolutePath, "r");
const head = Buffer.alloc(BINARY_SAMPLE_SIZE);
const { bytesRead } = await fd.read(head, 0, BINARY_SAMPLE_SIZE, 0);
await fd.close();
if (isBinaryBuffer(head.subarray(0, bytesRead))) {
  return parseContract(schemas.contentResponse, { content: "", path: relativePath, binary: true });
}
const content = await fs.readFile(absolutePath, "utf-8");
return parseContract(schemas.contentResponse, { content, path: relativePath, binary: false });
```

`isBinaryBuffer` 与 `BINARY_SAMPLE_SIZE` 已从 `@spherse/core` 导出（`packages/core/src/utils/binary-detect.ts`），直接复用，与 `read_file` / `search_content` 行为一致。

副作用收益：二进制文件不再被整体读进内存解码。PUT/POST/DELETE 不动（写入本就是 UTF-8，编辑器只对 `isEditable` 文件生效，二进制不在编辑路径）。

## 外部打开能力（桌面专用）

### IPC（`packages/desktop/electron/ipc/project.ts`）

紧邻 `open-project-folder` 新增：

```ts
ipcMain.handle("open-file", async (_event, filePath: string) => {
  if (typeof filePath !== "string" || !filePath) return;
  // 防御：仅允许打开已打开项目根目录内的文件（core isPathInside + getOpenProjects）
  if (!isInsideAnyOpenProject(filePath)) return;
  await shell.openPath(filePath);
});
```

`isInsideAnyOpenProject` 用 `@spherse/core` 的 `isPathInside` 对 `getOpenProjects()`（`packages/desktop/electron/settings.ts`）返回的项目根逐个判断，满足 AGENTS.md「路径安全」要求。`open-project-folder` 现有实现不做校验，本次不为它补（保持聚焦），但 `open-file` 因为接收任意路径必须校验。

### preload（`packages/desktop/electron/preload.ts`）

暴露：

```ts
openFile: (filePath: string) => ipcRenderer.invoke("open-file", filePath),
```

同步更新 `ElectronAPI` 类型（`packages/desktop/electron/types.ts`）。

### HostBridge（`packages/app/src/lib/host-bridge.ts`）

- `HostCapabilities` 新增 `openFileExternal: boolean`
- `ProjectHostApi` 新增 `openFileExternal(absolutePath: string): Promise<void>`（**必需**方法，与现有 `openProjectFolder` 接口风格一致）

实现：

- `host-bridge-electron.ts`：`capabilities.openFileExternal = true`，`project.openFileExternal = api.openFile`
- `host-bridge-web.tsx`：`capabilities.openFileExternal = false`，`project.openFileExternal` 为 no-op（与 web 端 `openProjectFolder` 一致）；按钮显隐由 capability 决定，不靠方法是否存在

## UI、i18n、边界

### 占位卡组件

新增 `packages/app/src/features/content-browser/UnsupportedFileCard.tsx`，由 `ContentView` 在 `other + binary` 分支渲染（替代 `<pre>`）：

- 居中文件图标 + 文案「此文件类型无法在 Spherse 内预览」
- 当 `bridge.capabilities.openFileExternal === true` 时显示主按钮「用默认应用打开」，点击调用 `bridge.project?.openFileExternal(path.join(projectRoot, filePath))`
- web 版（`capabilities.openFileExternal === false`）仅显示文案，无按钮

`projectRoot` 来自 `useProjectCtx()`（`ProjectCtx.projectRoot`，绝对路径），`filePath` 为项目相对路径。

### `useContentFile` hook

`packages/app/src/features/content-browser/hooks/useContentFile.ts` 暴露 `binary: boolean`（从响应取，缺省 `false` 兼容旧 server），传给 `ContentView`。

### i18n（`@spherse/i18n`）

`zh-CN.ts` 为基准（带场景注释），新增 `content-browser.unsupported.*`：

- `title`：占位卡主标题
- `description`：说明文案
- `openExternally`：按钮「用默认应用打开」

同步 `en` 与 `zh-TW`。

### 边界

- markdown 内部链接指向二进制文件 → 跳转后命中占位卡（行为一致）
- 图片 / HTML 仍走 preview 路由；其白名单不变，pdf 等仍 403，但这些本就由 content 路由 + 占位卡处理，不冲突
- FloatingContentBrowserContainer 现有逻辑：`content === null && error` 时关闭浮窗；二进制文件 `content === ""` 且无 error，不会被误关闭，正常显示占位卡

## 验证

- **server**：content 路由 GET 对二进制文件（写入含 null byte 的 buffer）返回 `binary: true` 且 `content === ""`；纯文本文件 `binary: false`；目录分支返回不受影响；契约 schema 解析含 / 不含 `binary` 字段均兼容
- **app**：`useContentFile` 正确解析 `binary`（含缺省兼容）；`UnsupportedFileCard` 在 `other + binary` 渲染、桌面显示按钮、web 隐藏按钮、点击调用 `openFileExternal` 传入正确绝对路径；`detectFileKinds` 含 `ico` 且 `other` 分类正确
- **core**：无新逻辑（复用已有 `isBinaryBuffer`，已覆盖）
- **E2E（可选）**：桌面端放一个 `.pdf` 进项目，打开后看到占位卡 + 「打开」按钮，点击由系统默认应用打开
