# AI 读取禁止列表设计

## 背景

项目侧栏的文件树由 `packages/app/src/features/project-panel/index.tsx` 组合，当前“文件”标题和 `FileTree` 相邻展示，但没有项目级文件访问设置。Agent 侧的文件读取能力主要在 core 层工具中实现，包括 `read_file`、`list_files`、`search_content`、`render_card` 的 `file_path` 读取，以及 agent profile `context` 预加载文件。仅在前端隐藏文件或提示模型不要读取，不能满足“禁止 AI 读取”的隐私诉求。

本功能需要在文件树右上角增加设置按钮，点击后弹出 dialog，让用户配置不允许 AI 读取的文件或目录。配置应跟随项目持久化，并在 core 层统一生效。

## 目标

- 在项目侧栏文件树标题行右侧增加一个设置按钮，与“文件”字符串并排。
- 点击按钮打开 dialog，用户可以查看、添加、删除不允许 AI 读取的项目内路径。
- 禁止列表按项目持久化，关闭并重新打开项目后仍然生效。
- Agent 运行时不得通过 core 工具或 profile context 读取禁止列表命中的文件内容。
- 禁止列表支持文件和目录；目录命中时递归禁止其下所有内容。
- 用户自身仍可通过文件树和内容浏览器查看、编辑这些文件；本功能只限制 AI。

## 非目标

- 不实现通配符、glob、正则或 `.gitignore` 风格规则。
- 不隐藏文件树中的禁止文件，不阻止人类用户打开或编辑文件。
- 不阻止 AI 写入被禁止读取的路径；如后续需要“禁止 AI 写入”，应单独设计。
- 不新增 per-agent 权限配置；本次是项目级全局规则，对所有 agent 生效。
- 不追溯清理历史会话中已经被读取或展示过的内容。

## 方案比较

### 方案 A：只在前端 dialog 保存并提示模型

在 renderer 本地保存禁止列表，并在发起对话时把规则写入提示词。优点是改动小，前端即可完成。缺点是没有强制力，agent 仍可能调用 `read_file` 或 `search_content` 读取命中路径，不能满足“禁止 AI 读取”。

### 方案 B：项目配置持久化 + core 工具统一拦截（推荐）

把禁止列表保存到 `.spherse/project.yaml`，server 暴露读写 API，前端 dialog 负责编辑配置。core 在构建 agent 和创建工具时读取该配置，并通过共享路径访问策略拦截所有会读取文件内容或暴露目录内容的 agent 入口。优点是规则有强制力、按项目生效、符合当前 ProjectStore/Engine 边界。缺点是需要同时改 app、server、core 和测试。

### 方案 C：创建独立 `.spherse/ai-denylist.json`

把禁止列表从 `project.yaml` 拆到独立文件。优点是未来规则复杂化时扩展空间更大，也可以避免频繁写 `project.yaml`。缺点是当前规则很小，引入新存储文件会增加 ProjectStore 初始化、迁移和文档成本；项目配置已经承载项目级元数据，放在其中更直接。

本次选择方案 B。

## 数据模型

在 `ProjectConfig` 中新增可选字段：

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
  aiAccess?: {
    deniedPaths: string[];
  };
}
```

`deniedPaths` 存储项目根目录内的相对路径，统一使用 `/` 分隔，不以 `/` 开头，不允许为空字符串，不允许 `.` 或路径穿越。目录规则不额外加后缀，匹配时通过文件系统 stat 或路径前缀判断：规则 `secrets` 命中 `secrets/key.md`，规则 `notes/private.md` 只命中该文件。

禁止列表不允许包含机制路径：`AGENTS.md`、`CHANGELOG.md`、`.spherse` 和 `.spherse/**`。这些路径承载项目索引、变更记录和 Spherse 元数据，不能由用户配置为 AI 读取禁止项，避免与 engine 必需上下文和项目元数据管理产生冲突。

新项目创建时可不写 `aiAccess`，读取时按空数组处理。保存时先规范化并去重，再写回 `project.yaml`。

## 前端设计

### 入口位置

`ProjectPanel` 当前渲染：

```tsx
<SidebarGroupLabel>
  文件
</SidebarGroupLabel>
<SidebarGroupContent>
  <FileTree ... />
</SidebarGroupContent>
```

调整为标题行容器：左侧保持 `SidebarGroupLabel` 的“文件”，右侧放一个小尺寸 icon button。按钮使用现有 `Button` 语义样式和 `Settings` 或等效图标，提供 `aria-label="设置 AI 文件读取限制"`。

### Dialog

新增 `packages/app/src/features/file-tree/AiReadDenylistDialog.tsx`。入口和文件路径选择语义都属于文件树区域，因此不放在 `features/project-panel`。

Dialog 内容：

- 标题：`AI 读取限制`
- 说明：`列表中的文件或目录不会被 AI 工具读取；你仍可正常查看和编辑。`
- 当前禁止路径列表，每行显示相对路径和删除按钮。
- 输入框用于手动添加项目相对路径。
- “添加当前输入”按钮；按 Enter 也添加。
- 底部显示保存状态和“取消 / 保存”按钮。

为了保持首版最小实现，不在 dialog 内嵌完整文件选择树。用户可以从文件树复制或输入路径。

### 状态边界

Dialog 的打开状态保留在 `ProjectPanel` 局部 `useState`。禁止列表属于项目持久数据，不放入 `project-ui-store`。加载和保存逻辑放在 `features/file-tree/useAiReadDenylist.ts` hook，内部调用 `client.getAiAccessSettings()` 和 `client.updateAiAccessSettings()`。

## API 设计

在 `packages/server/src/routes/settings.ts` 增加项目内设置接口：

- `GET /api/settings/ai-access` 返回 `{ deniedPaths: string[] }`
- `PUT /api/settings/ai-access` 接收 `{ deniedPaths: string[] }`，返回 `{ ok: true, deniedPaths: string[] }`

`packages/app/src/lib/api.ts` 增加：

```ts
async getAiAccessSettings(): Promise<{ deniedPaths: string[] }>;
async updateAiAccessSettings(deniedPaths: string[]): Promise<{ ok: boolean; deniedPaths: string[] }>;
```

server 只负责请求校验和转发到 `ProjectStore`。路径规范化和持久化由 core 层 `ProjectStore` 方法完成，避免 app/server 复制路径规则。

不直接复用通用 `/api/content/*` 文件读写接口来编辑 `.spherse/project.yaml`。原因是该接口面向人类项目内容浏览/编辑，而本功能需要结构化 schema、路径规则校验、机制路径拒绝和内存中 `ProjectStore.config` 同步；让前端直接读写 `project.yaml` 会绕过这些约束，也会把 `.spherse` 元数据编辑暴露成普通内容操作。实现内部可以复用 `ProjectStore` 对 `project.yaml` 的读写能力，但对 renderer 暴露专用 settings API。

## Core 访问控制

新增共享访问策略模块，例如 `packages/core/src/access/ai-file-access.ts`：

- `normalizeDeniedPath(input: string): string | null`
- `normalizeDeniedPaths(inputs: string[]): string[]`
- `createAiFileAccessPolicy(projectRoot: string, deniedPaths: string[])`
- `isDenied(relativePath: string): boolean`
- `assertReadableByAi(relativePath: string): void`

匹配规则：

- 所有输入先转为项目相对路径并使用 `/`。
- 路径穿越或项目根目录外路径直接拒绝。
- 规则命中自身时拒绝。
- 规则是目录或请求路径位于规则路径之下时拒绝。
- `.spherse` 默认不额外纳入本规则；现有 UI/API 已有部分 `.spherse` 限制。本功能只处理用户配置的 AI 读取限制。

需要接入的读取入口：

- `read_file`：命中时返回明确错误文本，如 `Access denied by AI read settings: <path>`，不读取文件。错误文本必须包含被禁止访问的项目相对路径，便于 LLM 理解是哪一次工具调用被策略拦截。
- `search_content`：递归搜索时跳过命中目录和文件，返回结果不包含禁止路径；如果搜索起点本身被禁止，返回拒绝信息。
- `list_files`：列表结果不包含禁止路径；如果列表起点被禁止，返回拒绝信息，避免 AI 通过目录结构推断敏感内容。
- `render_card` 的 `file_path`：命中时拒绝读取 HTML 文件。
- `readContextFiles`：跳过命中路径，不注入 system prompt。

写入工具 `write_file`、`edit_file`、`append_changelog` 本次不接入禁止读取策略，因为需求只限定“读取”。但如果 `edit_file` 需要先读旧内容再替换，命中禁止路径时也应拒绝执行，避免通过编辑返回或内部读取泄露内容。

## Engine 数据流

1. 项目打开时 `ProjectStore.open()` 读取 `.spherse/project.yaml`。
2. 用户在 dialog 保存禁止列表，server 调用 `ProjectStore.updateAiAccessSettings()` 写回配置并更新内存中的 `config`。
3. 新建或后续构建 agent 时，`Engine.buildAgent()` 从 `projectStore.getConfig()` 读取 `aiAccess.deniedPaths`。
4. `createToolsForProject()` 接收 denylist 或访问策略，并传入各个相关 tool factory。
5. `readContextFiles()` 接收 denylist 或访问策略，构建 system prompt 时跳过禁止路径。
6. 已经构建完成的活跃 agent 在保存后继续运行时，后续工具调用也必须使用最新禁止列表。工具闭包不能只捕获构建时的静态数组；应通过 `ProjectStore` 或 policy provider 读取当前配置。

## 错误处理与校验

- 前端输入为空、重复、包含路径穿越或命中机制路径（`AGENTS.md`、`CHANGELOG.md`、`.spherse`、`.spherse/**`）时禁止添加，并显示轻量提示。
- server 收到非法路径返回 400，不写入配置。
- core 工具命中禁止路径时返回普通 tool result 错误文本，而不是抛出导致 agent 流崩溃；错误文本必须包含被禁止访问的路径。
- 保存失败时 dialog 保持打开，显示 `保存失败`。
- 如果禁止路径之后被用户删除，规则仍保留；不存在的路径在未来重新创建后继续生效。

## 测试策略

### Core

- 为访问策略增加单元测试：路径规范化、去重、路径穿越拒绝、文件命中、目录递归命中、相似前缀不误伤（`secret` 不命中 `secret-notes`）。
- 更新 `read-file` 测试：命中禁止路径时不返回文件内容。
- 更新 `list-files` 测试：禁止路径不出现在列表中，禁止起点返回拒绝。
- 更新 `search-content` 测试：搜索结果跳过禁止路径。
- 更新 `read-context-files` 测试：禁止 context 不注入 prompt。

### App / Server

- 为 API client 或 store/hook 增加轻量测试，覆盖读取和保存接口调用。
- 如现有测试环境支持组件测试，覆盖 dialog 添加、删除、保存按钮状态。
- 至少运行 `npm test --workspace=packages/core` 和 `npm test --workspace=packages/app`。

## 文档同步

实现完成后更新 `docs/official/architecture.md`：

- Core 层补充项目级 AI 文件读取限制和受控工具。
- Server 层补充 `/api/settings/ai-access`。
- 前端 feature 列表如新增独立文件树设置组件，可补充说明。

如修改 `ProjectConfig` 约定，也应更新 `docs/official/data-conventions.md`。

## 验收标准

- 文件树标题行右侧出现设置按钮，点击后打开 AI 读取限制 dialog。
- 用户可以添加、删除并保存项目相对路径。
- 保存后的禁止列表写入 `.spherse/project.yaml` 并可重新加载。
- AI 调用 `read_file`、`search_content`、`list_files`、`render_card file_path` 或 profile context 时，不能读取或暴露禁止路径内容。
- 人类用户仍可通过文件树和内容浏览器打开相关文件。
- 相关 core 测试覆盖访问控制，app 测试覆盖基础 UI/API 行为。
