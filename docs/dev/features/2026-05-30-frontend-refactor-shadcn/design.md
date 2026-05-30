# 前端重构 1：引入 shadcn/ui 重构基础组件

## 背景

当前 `packages/app` 前端使用 React 19 + Tailwind CSS v4，业务组件中直接手写按钮、弹窗、菜单、表单、badge、markdown 样式等 UI 结构。样式大多分散在 JSX className 和 `src/styles.css` 中，行为层也存在多处重复实现，例如：

- `AgentDialog`、`SettingsModal`、`ContentBrowser` 中各自实现 modal/dialog
- `ProjectBar`、`ProjectPage`、`FileTree` 中各自实现 dropdown/context menu
- `AgentDialog`、`SettingsModal`、`SelectionSessionDialog` 中各自实现 field/input/textarea/select
- `ProjectAvatar` 手写 avatar
- `styles.css` 中通过 `.prose-content` 和 `.chat-markdown` 维护动态 Markdown 样式

本次重构的目标是先建立统一基础组件层，保留现有业务行为，完全替换旧视觉样式，先采用 shadcn/ui 默认样式。后续再通过独立任务调整 Spherse 的产品视觉。

## 需求对齐

### 本次范围

1. 引入 shadcn/ui，并使用指定 preset：

   ```bash
   npx shadcn@latest init --preset b1D0dv96 -c packages/app
   ```

   实施前需先用 CLI 解码/确认 preset：

   ```bash
   npx shadcn@latest preset decode b1D0dv96 --json
   ```

2. 对比 Radix UI 和 Base UI，选定 shadcn 的底层组件 base。
3. 迁移常见基础组件：dialog、button、select、sidebar、switch、avatar、dropdown/context menu、field、popover、badge。
4. 迁移受影响组件时保留原有行为，不保留原有样式。
5. 调研并设计动态 Markdown 渲染样式方案，减少 `styles.css` 中的手写 markdown selector。

### 非目标

- 不在本任务中重新设计 Spherse 品牌视觉。
- 不修改 core/server API。
- 不引入全局状态库。
- 不把业务组件一次性拆成完整设计系统。
- 不处理复杂富文本编辑器能力。
- 不新增 E2E 测试框架；本次以 build 和手动回归为主。

## 选型：Radix UI vs Base UI

### 官方信息

- shadcn CLI 支持通过 `--base <base>` 选择 `radix` 或 `base`，也支持 `--preset` 初始化配置。见 shadcn CLI docs: https://ui.shadcn.com/docs/cli
- shadcn 支持 Tailwind v4 和 React 19，组件使用 `data-slot`，并推荐 CSS variables + Tailwind v4 的 `@theme inline`。见 Tailwind v4 docs: https://ui.shadcn.com/docs/tailwind-v4
- Radix Primitives 是低层、无样式、关注 accessibility/customization/developer experience 的 React 组件库，可增量采用。见 Radix docs: https://www.radix-ui.com/primitives/docs/overview/introduction
- Base UI 是无样式 React 组件库，关注 accessible、composable、configurable，支持 Tailwind/CSS Modules/CSS-in-JS/plain CSS。见 Base UI docs: https://base-ui.com/

### 对比

| 维度 | Radix UI | Base UI | 对本项目的影响 |
|------|----------|---------|----------------|
| shadcn 成熟度 | shadcn 长期主路径，生态示例和第三方经验更多 | shadcn 已支持，但整体生态和迁移经验更新 | 本项目是第一次统一基础组件，低风险优先 |
| 组件覆盖 | Dialog、Dropdown Menu、Context Menu、Popover、Select、Switch、Avatar 等覆盖稳定 | 同样覆盖常用基础组件，API 更现代 | 两者都能覆盖本次需求 |
| React 19/Tailwind v4 | shadcn 已更新支持 | shadcn CLI 已支持 base 选项 | 两者均可用 |
| 可访问性 | Radix 官方主打 accessibility，已有大量生产使用 | Base UI 遵循 ARIA APG/WCAG 2.2，定位也很强 | 都优于现有手写实现 |
| 迁移成本 | 文档、示例、AI/社区上下文更多，遇到问题更容易查 | 需要更多项目内验证 | 本项目人力更适合稳妥落地 |
| 长期灵活度 | shadcn 组件源码进仓，可按需改 | 同样源码进仓，可按需改 | 差异不大 |

### 决策

选择 **shadcn/ui + Base UI base** 作为本次重构的默认方案。

原因：

- 本项目当前没有既有组件库包袱，可以在第一阶段直接选择更现代的底层原语，避免先迁到 Radix 后续又切换到 Base UI。
- Base UI 的定位更接近新一代 headless primitives，强调 composability、consistency、accessibility 和更完整的交互细节，适合作为 Spherse 后续长期 UI 基础层。
- shadcn 已支持 `--base base`，可以继续保留 shadcn 的本地源码模板、Tailwind v4、CSS variables 和默认样式工作流。
- 本次迁移会把 `components/ui/*` 视为项目内稳定 API。即使底层选择 Base UI，业务层也只依赖 shadcn 暴露出的本地组件，不直接散落使用 Base UI 原语。
- Radix UI 仍是低风险备选。如果 Base UI 版组件在某些控件上缺少 shadcn 支持或暴露出阻塞问题，再局部评估是否改用 Radix 版或保留原生控件。

## 安装与项目配置

### CLI 初始化

从仓库根目录执行，cwd 指向 app package：

```bash
npx shadcn@latest init --preset b1D0dv96 -c packages/app
```

如果 preset 未指定 base，初始化时选择：

- template: existing Vite/React project
- base: base
- rsc: false
- tsx: true
- tailwind css: `src/styles.css`
- tailwind config: 空字符串（Tailwind v4）
- aliases:
  - components: `@/components`
  - ui: `@/components/ui`
  - lib: `@/lib`
  - hooks: `@/hooks`
  - utils: `@/lib/utils`

### 需要补充的 app 配置

当前 `packages/app` 没有 `@/*` alias。shadcn 默认会生成 `@/components/ui/...` import，因此需要同步配置：

- `packages/app/tsconfig.json`：增加 `baseUrl` 和 `paths`
- `packages/app/electron.vite.config.ts`：renderer 增加 `resolve.alias`
- 新增 `packages/app/src/lib/utils.ts`，提供 `cn()`
- `packages/app/src/styles.css`：接入 shadcn preset 生成的 theme tokens 和 `tw-animate-css`

shadcn 手动安装文档要求依赖包含 `class-variance-authority`、`clsx`、`tailwind-merge`、`lucide-react`、`tw-animate-css` 等。见 manual docs: https://ui.shadcn.com/docs/installation/manual

## 组件引入清单

第一批安装：

```bash
npx shadcn@latest add button dialog select sidebar switch avatar dropdown-menu context-menu field popover badge textarea input label separator tooltip scroll-area -c packages/app
```

如 CLI 组件名或 preset 支持情况有差异，以 `npx shadcn@latest search @shadcn -q "<component>"` 和 `npx shadcn@latest docs <component> -b base` 的结果为准。

## 迁移策略

迁移采用“先基础层、再业务组件”的顺序。每个业务组件迁移时遵循三条规则：

1. 保留现有 props、状态、事件流、API 调用和边界行为。
2. 删除旧的视觉 className，不做像素级还原。
3. 只使用 shadcn 默认样式 + 必要布局工具类，不做品牌化覆盖。

## 业务组件映射

| 现有位置 | 现状 | 迁移组件 |
|----------|------|----------|
| `AgentDialog` | 手写 modal、输入、textarea、tag、建议列表、工具 chip | `Dialog`、`Button`、`Input`、`Textarea`、`Badge`、`Popover`、`Command` 或普通列表、`Field` |
| `SettingsModal` | 手写 modal、password input、select、保存状态 | `Dialog`、`Field`、`Input`、`Button`、`Select`、`Switch` 或 icon button |
| `ContentBrowser` | 手写确认弹窗、toolbar、segmented preview/source、编辑按钮 | `AlertDialog`、`Button`、`ToggleGroup` 或 `Tabs`、`Textarea`、`Badge` |
| `ProjectPage` sidebar | 手写 sidebar、agent/session 折叠、菜单 | `Sidebar`、`Button`、`DropdownMenu`、`Collapsible`、`Badge`、`ScrollArea` |
| `ProjectBar` | 手写 activity bar 和 context menu | `Avatar`、`Button`、`ContextMenu`、`Tooltip` |
| `ProjectAvatar` | div + inline style | `Avatar`、`AvatarFallback`，保留 path hash 颜色作为 fallback style |
| `FileTree` | 手写 tree row 和 context menu | `Button` row、`ContextMenu`，树行为继续保留本地实现 |
| `TextSelectionToolbar` | fixed div 按钮 | `Popover` 或 `Button`，仍按 selection position 定位 |
| `SelectionSessionDialog` | fixed mini dialog | `Popover`、`Button`、`Textarea`、`ScrollArea` |
| `ToolCallSection` | 手写折叠区、状态符号、代码块 | `Collapsible`、`Badge`、`Button`、`Separator` |
| `ChatPage` | 手写消息 bubble、agent type badge、send/abort button | `Badge`、`Button`、`Textarea`，消息布局保持业务组件自管 |

## 行为保留清单

### Dialog/Modal

- 点击遮罩关闭：`AgentDialog`、`SettingsModal` 保留现有行为。
- Escape 关闭：改由 shadcn/Base UI Dialog 默认处理。
- 阻止内容区点击冒泡关闭：改由 DialogContent 默认结构承载。
- 保存中 disabled 状态、错误展示、成功消息保持。
- `ContentBrowser` 的离开/取消确认从手写 overlay 迁移到 `AlertDialog`，仍只有用户确认后才放弃修改。

### Menu/Context Menu

- `ProjectBar` 项目右键菜单：保留“关闭项目”“在 Finder 中显示”。
- `ProjectPage` agent/session 菜单：保留“新建对话”“编辑”“删除”。
- `FileTree` 文件/目录右键菜单：保留删除确认和刷新展开节点。
- 点击外部关闭和 Escape 关闭由 shadcn/Base UI menu/context-menu 接管。

### Form

- `AgentDialog` 保留 name、tools、context、systemPrompt 字段行为。
- context 输入保留模糊匹配、回车添加、点击建议添加。
- `SettingsModal` 保留 API Key 显示/隐藏、默认模型按已配置 provider 分组。
- 原生 `<select><optgroup>` 迁移到 shadcn `Select` 时，需要保留 provider 分组语义；如 shadcn Select 不适合分组展示，可以阶段性保留原生 select 并套 `Field`/`Label`。

### Sidebar

- 保留左侧项目 Activity Bar 和项目内 agent/file sidebar 两层结构。
- shadcn `Sidebar` 只用于项目内 sidebar，不替换最左侧 ProjectBar 的整体模型。
- ChatPage 用 hidden 保持状态的现有行为不变。

## 样式与主题策略

### 第一阶段

- 使用 preset `b1D0dv96` 提供的 shadcn 默认 theme tokens。
- 原有 `--surface`、`--base`、`--accent` 等变量暂时保留，以免尚未迁移的组件失样式。
- 新迁移组件只使用 shadcn semantic tokens，如 `bg-background`、`text-foreground`、`border-border`、`bg-primary`、`text-muted-foreground`。
- 不在本阶段为 Spherse 重写 shadcn 组件源码主题。

### 第二阶段

当第一批基础组件迁移完成后，再单独开任务：

- 收敛旧 CSS variables 和 shadcn variables 的映射。
- 清理 `styles.css` 中未使用的旧 token。
- 调整桌面工具风格、密度、深浅色对比。
- 建立 Spherse 自有组件组合，如 `AppDialog`、`SidebarTreeItem`、`MessageBubble` 等。

## 动态 Markdown 样式方案

当前：

- `ContentBrowser` 使用 `.prose-content`
- `ChatPage` 使用 `.chat-markdown`
- 两者都在 `styles.css` 中手写 h1/p/code/pre/table/list selector

### 可选方案

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 继续手写 selector | 零依赖，完全可控 | 和 shadcn theme 脱节，长期难维护 | 不推荐 |
| `@tailwindcss/typography` + `prose` | 专门处理无法逐元素加 class 的 HTML/Markdown，适合 Markdown 内容 | 需要新增依赖和 Tailwind plugin；默认文章风格可能偏网页内容 | 可用于 ContentBrowser |
| react-markdown `components` map | 可直接把 markdown 节点映射到 shadcn 风格元素和 utility class | 需要维护一份 Markdown renderer 组件 | 推荐作为主方案 |
| Streamdown / assistant-ui markdown | 对 AI streaming markdown 体验更强 | 额外引入更大抽象，不符合本次基础重构范围 | 后续可评估 |

### 推荐方案

新增 `packages/app/src/components/MarkdownContent.tsx`，统一封装 `react-markdown` + `remark-gfm`：

```typescript
interface MarkdownContentProps {
  children: string;
  variant?: "chat" | "document";
}
```

实现策略：

- 继续使用 `react-markdown`，保留 GFM 支持。react-markdown 支持通过 `components` 映射 tag 到 React 组件。见 docs: https://github.com/remarkjs/react-markdown
- 在 `components` map 中为 `h1/h2/h3/p/ul/ol/li/code/pre/table/th/td/a/blockquote` 绑定 Tailwind utility class。
- class 使用 shadcn theme token，不依赖 `.chat-markdown` 和 `.prose-content`。
- `variant="chat"` 使用更紧凑的 margin、font-size。
- `variant="document"` 使用更宽松的 reading layout。
- 暂不引入 `@tailwindcss/typography`，避免本阶段再增加一套 prose 视觉系统。

迁移后：

- `ChatPage` 使用 `<MarkdownContent variant="chat">{msg.content}</MarkdownContent>`
- `ContentBrowser` 使用 `<MarkdownContent variant="document">{content}</MarkdownContent>`
- `styles.css` 中删除 `.chat-markdown` 和 `.prose-content` 规则。

## 文件变更范围

### 新增

- `packages/app/components.json`
- `packages/app/src/components/ui/*`
- `packages/app/src/lib/utils.ts`
- `packages/app/src/components/MarkdownContent.tsx`

### 修改

- `packages/app/package.json`
- `packages/app/tsconfig.json`
- `packages/app/electron.vite.config.ts`
- `packages/app/src/styles.css`
- `packages/app/src/components/AgentDialog.tsx`
- `packages/app/src/components/SettingsModal.tsx`
- `packages/app/src/components/ProjectBar.tsx`
- `packages/app/src/components/ProjectAvatar.tsx`
- `packages/app/src/components/FileTree.tsx`
- `packages/app/src/components/SelectionSessionDialog.tsx`
- `packages/app/src/components/TextSelectionToolbar.tsx`
- `packages/app/src/components/ToolCallSection.tsx`
- `packages/app/src/pages/ProjectPage.tsx`
- `packages/app/src/pages/ChatPage.tsx`
- `packages/app/src/pages/ContentBrowser.tsx`

### 官方文档同步

功能完成后检查并更新：

- `docs/official/project-structure.md`：补充 `components/ui`、`components.json`、`lib/utils.ts`、`MarkdownContent.tsx`
- `docs/official/architecture.md`：补充前端 UI 基础层和 shadcn/theme token 约定
- `docs/dev/backlog.md`：完成后将“统一 UI 基础组件”标为 `[x]`

## 实施顺序

1. **初始化 shadcn**
   - 解码 preset
   - 执行 init
   - 配置 alias、utils、styles
   - 安装第一批基础组件
   - 运行 `npm run build --workspace=packages/app`

2. **迁移无业务风险的基础控件**
   - `ProjectAvatar` → `Avatar`
   - 简单按钮 → `Button`
   - type/status 标签 → `Badge`

3. **迁移菜单与弹层**
   - `ProjectBar` → `ContextMenu`
   - `FileTree` → `ContextMenu`
   - `ProjectPage` agent/session menu → `DropdownMenu`
   - `TextSelectionToolbar` / `SelectionSessionDialog` → `Popover`

4. **迁移 Dialog/Form**
   - `SettingsModal` → `Dialog` + `Field` + `Input` + `Select`
   - `AgentDialog` → `Dialog` + `Field` + `Input` + `Textarea` + `Popover` + `Badge`
   - `ContentBrowser` leave/cancel confirm → `AlertDialog`

5. **迁移 Sidebar/Collapsible**
   - `ProjectPage` 内侧 sidebar 使用 `Sidebar`
   - agent/session 折叠使用 `Collapsible`
   - `ToolCallSection` 使用 `Collapsible` + `Badge`

6. **迁移 Markdown**
   - 新增 `MarkdownContent`
   - 替换 `ChatPage` 和 `ContentBrowser`
   - 删除旧 markdown CSS selector

7. **回归与文档同步**
   - build
   - 手动回归核心路径
   - 更新 `docs/official/`
   - 更新 backlog 状态

## 手动回归清单

- 启动 app，恢复已打开项目。
- 添加项目、切换项目、右键关闭项目、在 Finder 中显示。
- 创建 Agent、编辑 Agent、删除 Agent。
- 创建会话、发送消息、流式响应、停止生成。
- tool call 折叠/展开、路径点击跳转。
- 文件树展开、右键删除、文件变更刷新。
- Markdown 文件预览、普通文本预览、HTML 预览/源码切换。
- 文件编辑保存、取消编辑、未保存离开确认、外部修改冲突提示。
- 划取文本发起会话。
- 设置 API key、显示/隐藏 key、选择默认模型、保存设置。
- 浅色/深色模式。

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| preset 与 Base UI 决策不一致 | 初始化后的组件 base 与设计冲突 | 实施前必须 decode preset；若 preset 指定非 Base UI，需要明确记录并确认是否覆盖 |
| Base UI 版 shadcn 组件生态较新 | 迁移时可能遇到文档、示例或组件覆盖不足 | 先用 CLI docs/view 验证第一批组件；遇到阻塞时优先降低迁移范围或阶段性保留原生控件 |
| shadcn Select 不完全适配 optgroup | 默认模型选择体验退化 | 可阶段性保留原生 select，后续再换 combobox |
| Sidebar 组件改变 DOM 结构 | ChatPage hidden 保持状态行为受影响 | sidebar 迁移只限 aside 内部，不改变 main 的 mount/hidden 逻辑 |
| Dialog 默认焦点/关闭行为改变 | 表单输入或保存流程受影响 | 逐个保留 open state、onOpenChange、disabled 状态并回归 |
| Markdown 样式差异 | 聊天和文档可读性变化 | 通过 `variant` 分离 chat/document 密度 |
| `styles.css` token 混用 | 迁移期间样式不一致 | 允许过渡期共存，迁移完成后单独清理 |

## 验收标准

- app build 通过。
- 第一批基础组件已由 shadcn/ui 承载。
- 受影响组件的业务行为与迁移前一致。
- 新迁移组件不再复用旧视觉 className。
- ChatPage 和 ContentBrowser 的 Markdown 渲染走统一 `MarkdownContent`。
- `styles.css` 中不再包含 `.chat-markdown` 和 `.prose-content` 手写规则。
- `docs/official/` 和 `docs/dev/backlog.md` 按本次完成内容同步更新。
