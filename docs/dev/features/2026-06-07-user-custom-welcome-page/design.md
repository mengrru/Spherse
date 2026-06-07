# 用户自定义欢迎页设计

日期：2026-06-07

## 背景

当前项目主区域由 `ProjectLayout` 根据路由展示 Chat、ContentBrowser 或空状态：

- `/project/:projectKey/chat/:sessionId` 展示对话。
- `/project/:projectKey/content?path=...` 展示文件内容。
- `/project/:projectKey` 没有选中对话或内容时，只展示 `chat.startConversation` 空状态。

项目头像已经有右键菜单，当前只支持“关闭项目”和“在 Finder 中显示”。用户希望为每个项目配置一个 HTML 文件或图片作为欢迎页，并且 Chat 页面需要一个显式关闭按钮，让用户可以从对话回到欢迎页。

## 目标

- 用户可以在项目头像右键菜单中打开“设置欢迎页”。
- 欢迎页配置是项目级设置，随项目持久化。
- 用户可以添加、替换或清除一个欢迎页文件路径。
- 欢迎页文件支持项目内 HTML 文件和常见图片文件。
- 当用户访问 `/project/:projectKey` 且没有正在展示的 chat/content 时，主区域展示该项目欢迎页。
- Chat 页面提供显式关闭按钮，点击后回到 `/project/:projectKey`，从而展示欢迎页或默认空状态。

## 非目标

- 不支持多个欢迎页、轮播、按 agent/session 切换欢迎页。
- 不支持远程 URL；只支持项目目录内文件。
- 不实现可视化文件选择器；首版只提供路径输入、保存和清除。
- 不把欢迎页作为 AI 上下文，也不影响 agent prompt。
- 不改变 ContentBrowser 对 HTML 文件的预览能力。
- 不实现欢迎页编辑器；用户仍通过现有内容浏览器或外部编辑器维护文件。

## 需求对齐与假设

- “某个 html 文件或图片”解释为项目根目录内的相对路径。原因是当前每个项目都有独立 local server，`/api/preview/*` 已按项目根目录提供 HTML/图片资源，并且项目级配置不应指向项目外任意文件。
- “添加欢迎页文件路径”首版只保存一个路径。需求没有提出列表或多入口，单路径能满足“某个文件”的表述。
- 未配置、路径不存在或文件类型不支持时，保留现有空状态文案作为 fallback，不阻塞项目使用。
- Chat 关闭按钮只关闭当前 Chat 视图，不删除 session、不中断已归档数据。若正在流式输出，关闭按钮会先触发现有 `abort()` 再导航回欢迎页，避免后台继续输出造成状态混乱。

## 方案比较

### 方案 A：renderer localStorage 保存欢迎页路径

把每个 projectKey 的欢迎页路径保存在 renderer localStorage。优点是实现最小，不需要 server/core 改动。缺点是 projectKey 只在当前打开项目集合内稳定，配置不能跟随项目目录迁移；多设备或清理 renderer 数据后配置丢失；也不符合“project 级别设置”的语义。

### 方案 B：写入 `.spherse/project.yaml` 并通过 settings API 读写（推荐）

在 `ProjectConfig` 中新增 `welcomePage` 配置，由 `ProjectStore` 负责校验和持久化，server 暴露专用 settings API，renderer 通过项目 client 读写。优点是配置跟随项目、符合现有 AI 读取限制的项目级设置模式、能复用 preview 路由渲染 HTML/图片。缺点是需要同时修改 core/server/app/i18n。

### 方案 C：独立 `.spherse/welcome-page.json`

把欢迎页配置拆为独立 JSON 文件。优点是未来欢迎页配置复杂化时扩展空间更大。缺点是当前只保存一个路径，引入新文件会增加项目初始化和文档成本；`project.yaml` 已承载项目级元数据，拆分没有必要。

本次选择方案 B。

## 数据模型

在 `packages/core/src/types.ts` 的 `ProjectConfig` 中新增可选字段：

```ts
interface ProjectConfig {
  name: string;
  created: number;
  defaultModel: string;
  paths: {
    agents: string;
    index: string;
    changelog: string;
  };
  aiAccess?: { deniedPaths: string[] };
  welcomePage?: {
    path: string;
  };
}
```

路径规则：

- 存储项目根目录内相对路径，统一使用 `/` 分隔。
- 不允许空字符串、`.`、绝对路径或路径穿越。
- 不允许 `.spherse` 和 `.spherse/**`。
- 支持扩展名：`html`、`htm`、`png`、`jpg`、`jpeg`、`gif`、`webp`、`svg`。
- 保存时只校验路径形态和扩展名，不强制文件必须已经存在。这样用户可以先配置未来要创建的欢迎页文件；渲染时不存在则显示 fallback。

`ProjectStore` 新增方法：

```ts
getWelcomePageSettings(): { path: string | null };
updateWelcomePageSettings(path: string | null): Promise<{ path: string | null }>;
```

保存 `null` 表示清除欢迎页配置，并从 `project.yaml` 中移除或置空 `welcomePage`。

## API 设计

在 `packages/server/src/routes/settings.ts` 增加项目级欢迎页接口：

- `GET /api/settings/welcome-page` 返回 `{ path: string | null }`
- `PUT /api/settings/welcome-page` 接收 `{ path: string | null }`，返回 `{ ok: true, path: string | null }`

server 只做 body 形态校验，并把路径校验交给 `ProjectStore`，避免 app/server 重复规则。

在 `packages/app/src/lib/api.ts` 增加：

```ts
async getWelcomePageSettings(): Promise<{ path: string | null }>;
async updateWelcomePageSettings(path: string | null): Promise<{ ok: boolean; path: string | null }>;
```

欢迎页渲染继续使用现有 `client.getPreviewUrl(filePath)`。当前 `/api/preview/*` 已支持 HTML、图片和相关静态资源，并做项目根目录限制。实现时应修正 preview 路由的路径安全判断为 `absolutePath === root || absolutePath.startsWith(root + path.sep)`，避免相似前缀目录误判。

## 前端设计

### 入口位置

`ActivityBar` 中每个项目头像已有 `ContextMenu`。在菜单中新增一项：

- `设置欢迎页`：打开该项目的欢迎页设置 dialog。

`ActivityBarProps` 新增：

```ts
onWelcomePageSettings: (projectKey: string) => void;
```

`App.tsx` 持有当前正在设置欢迎页的 `projectKey | null`，并根据 `projects.get(projectKey)?.ctx.client` 渲染 dialog。这样可以在右键非当前项目头像时直接配置该项目，不强制切换项目。

### 设置 Dialog

新增 `packages/app/src/features/welcome-page-settings/index.tsx` 或放在 `features/activity-bar/WelcomePageSettingsDialog.tsx`。推荐独立 feature 目录，因为它是项目级设置，不属于 ActivityBar 的纯展示职责。

Dialog 内容：

- 标题：`设置欢迎页`
- 说明：`选择项目内 HTML 文件或图片作为项目欢迎页。`
- 路径输入框，占位示例：`welcome.html` 或 `assets/welcome.png`
- “清除”按钮：把 path 置为 `null`
- “取消 / 保存”按钮
- 加载、保存和错误提示使用现有 toast/i18n 模式

状态边界：

- Dialog 打开状态由 `App.tsx` 管理。
- 输入、loading、saving、error 保留在 dialog/hook 局部状态。
- 不放入 `project-ui-store`，因为这是持久项目设置，不是纯 UI 状态。
- 不放入 `project-data-store`，因为它不是 agents/sessions 等业务列表缓存。

### 欢迎页渲染

在 `ProjectLayout` 中新增欢迎页加载和展示逻辑：

1. 当 `projectKey` 或 `project.ctx.client` 变化时，调用 `client.getWelcomePageSettings()`。
2. 当 `!showingContent && !selectedSession` 时，渲染 `WelcomePage`。
3. 如果 `path` 为空，展示现有 `chat.startConversation` 空状态。
4. 如果是 HTML，使用 iframe：`src={client.getPreviewUrl(path)}`。
5. 如果是图片，使用 `img` 居中展示，最大宽高不超过主区域。
6. iframe/img 加载失败时显示错误 fallback 和配置的路径。

新增组件建议：

- `packages/app/src/features/welcome-page/index.tsx`：根据 path 和扩展名渲染 HTML/image/fallback。
- 或 `packages/app/src/features/project-welcome/index.tsx`：如果命名上要避免和设置 feature 混淆。

HTML iframe 建议加 `sandbox="allow-scripts allow-same-origin"`。欢迎页是用户选择的本地项目内容，允许脚本能支持动态欢迎页；不加 `allow-top-navigation`、`allow-popups`，避免欢迎页脚本影响应用窗口。图片通过 `<img>` 展示，不内联 SVG 内容。

### Chat 关闭按钮

`ChatProps` 新增：

```ts
onClose?: () => void;
```

`ProjectLayout` 传入：

```ts
onClose={() => navigate(`/project/${projectKey}`)}
```

`features/chat/Header.tsx` 在右侧添加一个 icon button：

- 图标：`XIcon`。
- 文案/aria-label：`关闭对话`。
- 点击时调用 `onClose`。

如果当前 `streaming` 为 true，`Chat` 点击关闭前调用 `abort()`，再执行 `onClose()`。这需要 `Header` 或 `Chat` 中的按钮处理函数能访问 `streaming` 和 `abort`。推荐把 close button 仍放在 `Header`，但 `Chat` 传入 `onCloseChat`：

```ts
const handleClose = () => {
  if (streaming) abort();
  onClose?.();
};
```

## 路由与 lastRoute 行为

- 欢迎页使用已有 `/project/:projectKey` 根路由，不新增 `/welcome` 路由。
- Chat 关闭按钮导航到 `/project/:projectKey`。
- `ProjectLayout` 现有 `setProjectLastRoute` 会把根路由保存为 `""`。这意味着用户关闭 chat 后切换项目或重启应用，会回到欢迎页，符合显式关闭的预期。
- 从 agent/session 列表点击 session 时仍进入 chat route；欢迎页不影响 session 选择逻辑。

## 错误处理与校验

- 前端输入非法路径或不支持扩展名时，保存前提示错误。
- server/core 收到非法路径时返回 400，dialog 保持打开。
- 欢迎页 path 已配置但文件不存在时，主区域显示“欢迎页文件不存在”提示和路径，不自动清除配置。
- preview 读取失败时 iframe/img fallback 显示错误提示。
- 清除配置后立即回到默认空状态。

## i18n

新增用户可见文案需写入 `packages/i18n/src/locales/{zh-CN,zh-TW,en}.ts`，并在 `zh-CN.ts` 为每条文案添加场景注释。

建议 key：

- `activity-bar.setWelcomePage`
- `welcome-page-settings.title`
- `welcome-page-settings.description`
- `welcome-page-settings.pathLabel`
- `welcome-page-settings.pathPlaceholder`
- `welcome-page-settings.clear`
- `welcome-page-settings.invalidPath`
- `welcome-page-settings.unsupportedType`
- `welcome-page-settings.loadFailed`
- `welcome-page-settings.saveFailed`
- `welcome-page-settings.saved`
- `welcome-page.fileMissing`
- `welcome-page.loadFailed`
- `chat.close`

## 涉及文件

| 文件 | 改动类型 |
|------|----------|
| `packages/core/src/types.ts` | 修改：新增 `ProjectConfig.welcomePage` |
| `packages/core/src/store/project.ts` | 修改：新增欢迎页设置读写与路径校验 |
| `packages/core/src/__tests__/store/project.test.ts` | 修改：覆盖欢迎页配置读写、清除和非法路径 |
| `packages/server/src/routes/settings.ts` | 修改：新增欢迎页 settings API |
| `packages/app/src/lib/api.ts` | 修改：新增欢迎页 API client 方法 |
| `packages/app/src/features/activity-bar/index.tsx` | 修改：项目头像右键菜单新增设置入口 |
| `packages/app/src/App.tsx` | 修改：管理欢迎页设置 dialog 的打开项目 |
| `packages/app/src/features/welcome-page-settings/index.tsx` | 新增：欢迎页设置 dialog |
| `packages/app/src/features/welcome-page/index.tsx` | 新增：欢迎页渲染组件 |
| `packages/app/src/layouts/ProjectLayout.tsx` | 修改：加载并展示欢迎页，Chat close 回到根路由 |
| `packages/app/src/features/chat/index.tsx` | 修改：接收 close 回调并处理 streaming abort |
| `packages/app/src/features/chat/Header.tsx` | 修改：显示关闭按钮 |
| `packages/i18n/src/locales/*.ts` | 修改：新增文案 |
| `docs/official/architecture.md` | 实现后同步：项目级欢迎页设置和前端 route 行为 |
| `docs/official/data-conventions.md` | 实现后同步：`ProjectConfig.welcomePage` 约定 |

## 测试策略

### Core

- `ProjectStore` 欢迎页设置默认返回 `null`。
- 保存合法 HTML 和图片路径后写入 `project.yaml`，重新打开项目后仍可读取。
- 保存 `null` 后清除配置。
- 拒绝绝对路径、路径穿越、`.spherse/**` 和不支持扩展名。

### App

- 欢迎页设置 hook/dialog 能加载、编辑、保存、清除路径。
- `ProjectLayout` 在根路由且无 selectedSession/content 时渲染欢迎页。
- 未配置欢迎页时继续显示原空状态。
- Chat 关闭按钮调用导航回 `/project/:projectKey`；streaming 时先调用 abort。

### Server

- `GET /api/settings/welcome-page` 返回当前配置。
- `PUT /api/settings/welcome-page` 保存合法路径、清除 null、非法路径返回 400。

至少运行：

- `npm test --workspace=packages/core`
- `npm test --workspace=packages/app`
- 如 server 路由已有测试基础，补充并运行对应 server 测试；否则通过 app/api client 单测覆盖基础请求形态。

## 验收标准

- 项目头像右键菜单出现“设置欢迎页”。
- 用户可以为当前打开的任意项目保存或清除一个项目内 HTML/图片路径。
- 配置写入 `.spherse/project.yaml`，关闭并重新打开项目后仍生效。
- `/project/:projectKey` 显示配置的 HTML iframe 或图片欢迎页。
- 未配置或加载失败时有明确 fallback，不影响 chat/content 使用。
- Chat 页面有显式关闭按钮，点击后回到项目欢迎页；不删除 session。
- 相关 i18n 文案齐全，`zh-CN` 注释符合现有规范。
