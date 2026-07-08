# Windows 路径保护机制修复

## 问题现象

在 Windows 中，HTML card（及 Image card）点击保存按钮时，即使选择了项目目录内的合法路径，也会被错误判定为「文件必须保存在项目目录内」并拒绝保存。

## 根因分析

渲染进程侧的路径边界校验硬编码了正斜杠 `/` 作为分隔符：

```ts
// packages/app/src/features/chat/HtmlCard.tsx:53,61,70
const defaultPath = projectRoot + "/" + suggestedName;
if (!filePath.startsWith(projectRoot + "/") && filePath !== projectRoot) { ... }
const relativePath = filePath.slice(projectRoot.length + 1);
```

`ImageCard.tsx:19,30` 同样存在此问题。

### Windows 下的具体失败路径

| 变量 | 值（Windows） |
|------|--------------|
| `projectRoot` | `C:\Users\foo\project` |
| `filePath`（Electron `showSaveDialog` 返回） | `C:\Users\foo\project\card.html` |
| `projectRoot + "/"` | `C:\Users\foo\project/` |
| `filePath.startsWith(projectRoot + "/")` | **`false`**（`\card.html` ≠ `/card.html`） |

结论：**所有合法的项目内保存都被误判拒绝**（false negative，UX 故障，非安全旁路）。

### 附带问题

1. **`defaultPath` 分隔符混合**：`projectRoot + "/" + name` 在 Windows 上生成 `C:\...\project\card.html` 与 `C:\...\project/card.html` 混合形态，对话框默认路径不规范。
2. **`relativePath` 切片假设 1 字符 `/` 分隔符**：`filePath.slice(projectRoot.length + 1)` 在 Windows 上即使通过了校验也会切错。
3. **`startsWith` 前缀判定是 AGENTS.md 明确反对的反模式**：会被同名前缀的兄弟目录欺骗（`/tmp/project` vs `/tmp/project-evil`）。当前在 Windows 仅造成 false negative，但 POSIX 上存在前缀碰撞隐患。

### 服务端保护为何没问题

core 的 `isPathInside` / `resolveProjectPath`（`packages/core/src/utils/path-safety.ts`）基于 `node:path` 的 `path.relative` / `path.resolve`，是 OS 感知的，Windows 上能正确处理 `\` 与盘符。`access-policy.ts`、`denied-paths.ts`、`path-category.ts` 在做分类前都先把 `\` 规范化为 `/`，逻辑稳健。

渲染进程被沙箱化（`nodeIntegration:false` + `contextIsolation:true`，见 `electron/window.ts:16-17`），无法引入 `node:path`，因此手写了带 bug 的字符串操作。

## 修复方案

### 1. 新增浏览器安全的纯 JS 路径工具

`packages/app/src/lib/project-path.ts`，导出两个纯函数（不依赖 `node:path`）：

- `isPathInsideProject(projectRoot: string, absPath: string): boolean`
  - 将两端 `\` 统一规范为 `/`，Windows 盘符做大小写无关比较
  - 复刻 core `isPathInside` 思路：计算相对 root 的剩余段，拒绝 `..` 开头 / 绝对路径 / 空之外的越界
- `toProjectRelative(projectRoot: string, absPath: string): string`
  - 先 `isPathInsideProject` 断言，再返回以 `/` 为分隔符的相对路径（API URL 友好）

### 2. 替换渲染进程内的手写校验

- `HtmlCard.tsx`：用 `isPathInsideProject` 做边界判断、`toProjectRelative` 算 `relativePath`；`defaultPath` 用跨平台分隔符拼接
- `ImageCard.tsx`：用 `isPathInsideProject` 做边界判断；`defaultPath` 修正

### 3. 测试

为 `project-path.ts` 补单元测试，覆盖：
- POSIX 根目录、Windows `C:\` 根目录
- 反斜杠路径、正斜杠路径、混合分隔符
- 同名前缀兄弟目录碰撞（`/tmp/project` vs `/tmp/project-evil`）
- `..` 穿越
- 恰好等于根目录

服务端无需改动（已通过 `resolveProjectPath` + access policy 二次校验，本修复是渲染侧 UX 误拒修复 + 与核心一致的深度防御）。

## 影响面

- 渲染进程：`HtmlCard.tsx`、`ImageCard.tsx`、新增 `lib/project-path.ts`
- 服务端 / core：无改动
- 无 schema / API / i18n 变更（`chat.fileMustBeInProject` 文案复用）
