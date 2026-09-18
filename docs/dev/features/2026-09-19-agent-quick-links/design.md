# Agent 快捷链接（Quick Links）设计

- 日期：2026-09-19
- 状态：已商定，待实施

## 背景与目标

用户希望为智能体配置一组「快捷链接」（项目内文件路径），显示为聊天窗口 header 上的按钮，一键打开常用文件：

- **移动端**（`useIsMobile()` < 768px）：点击后从 header 下方划出一个覆盖式面板，高度暂定 35%，内容复用 content browser 的 ContentView 轻量嵌入（与桌面文件浮窗同款）
- **桌面端**：点击打开文件浮窗（复用现有 floating-content-browser，同路径幂等复用）
- 配置入口：Agent Dialog 中「主题」标签页改为「个性化」，收入主题 + 快捷链接
- 文件选择器复用「基本」页「参考资料」所用组件（`ContextPathField` = Badge 列表 + `SearchFileField`）
- 快捷链接配置持久化在 agent profile（profile.md frontmatter）
- 不持久化打开状态：每次打开聊天窗口不恢复；PC 端关闭聊天窗口不连带关闭快捷链接打开的浮窗（现有浮窗挂 ProjectScope + localStorage，天然满足）

## 已确认的产品决策

1. 数据模型：纯文件路径数组 `quickLinks: string[]`，按钮文本自动显示文件名（basename），无自定义名称
2. 桌面端复用现有 floating-content-browser store（`openFloat` 幂等、沿用其 localStorage 持久化行为）
3. 移动端面板轻量复用：ContentView + useContentFile，面板顶部加细 header（文件名 + 关闭按钮）
4. 浮窗聊天（floating chat，hideHeader）不显示快捷链接按钮，仅普通聊天窗口

## 决策

| 决策点 | 结论 |
|---|---|
| 持久化位置 | profile.md frontmatter 字段 `quickLinks`（同 `context` 模式）。create/update 请求体携带完整 raw markdown，无需扩 API 签名；但 `GET /agents/:id` 响应走 Fastify response schema 序列化（fast-json-stringify 只输出已声明属性），contracts schema 必须显式声明，否则字段被剥掉（客户端 `parseContract` 只做校验，不负责剥字段） |
| 双 parser 同步 | core `agent-profile.ts` `parseFile` 与 renderer `agent-markdown.ts` 都要解析新字段，否则掉进 `extraFrontmatter` 黑盒（core 侧类型丢失）/ renderer 表单丢数据 |
| renderer 数据获取 | `AgentSummary` 不含 quickLinks，`Chat` 内新增 agent profile detail query（`client.getAgent` 已有 API），`enabled: !hideHeader && Boolean(client)`，经 `queries/project/index.ts` barrel 导出；`updateProjectAgent` 成功后失效 detail 缓存 |
| 打开状态 | `Chat` 本地 state `activeQuickLink: string \| null`，不进 store、不落 localStorage；Chat 以 `key={session.id}` 重挂载，重开聊天窗口自然重置。**仅为移动面板状态：桌面（openFloat）分支不写入**，避免桌面→移动 resize 时旧面板自动弹出；Header 的 active 高亮仅在移动端语义下成立（Chat 传 `activeQuickLink={isMobile ? activeQuickLink : null}`） |
| 行为分流 | 提炼纯函数 `resolveQuickLinkAction(isMobile, floatEnabled): "panel" \| "float" \| "navigate"`（QuickLinkPanel.tsx 或独立模块导出，单测覆盖三分支）：`isMobile` → toggle 本地面板；非 mobile 且 `useFeature("floating-content-browser")` → `openFloat(projectId, path)`；非 mobile 且 web host → navigate 到 content page（与 openFile float 降级一致） |
| 面板定位 | header 外包一层 `relative shrink-0` wrapper，面板 `absolute top-full inset-x-0 z-30`（对齐 side-panel 抽屉的层叠量级，压过 MessageList 内 sticky/滚动按钮），高度 `h-[35dvh]`（绝对定位下百分比高度会错误解析到 wrapper，用 dvh 近似"35%"，移动 PWA 全屏下即窗口高的 35%）。**实施调整**：放弃「常驻挂载 + translate-y + inert」改为「打开时挂载 + `animate-in slide-in-from-top` 入场动画，关闭即卸载」——`useContentFile` 无 enabled 参数，常驻挂载会在关闭态以空路径发起无效请求；关闭方向无动画为可接受代价，切换链接时组件不重挂载故动画不重播 |
| 面板关闭 | 面板自带 X 按钮（title/aria 复用现有 `chat.close`，不新造 key）；再点同一按钮 toggle 关闭；点其他链接切换内容（不重播动画）；quickLinks 刷新后若 `activeQuickLink` 不在新列表则置 null（配置侧删除链接的边界） |
| tab 改名 | Tabs value `theme` → `personalization`；i18n 语义 key 原则：删 `agent-dialog.tabTheme`，新增 `agent-dialog.tabPersonalization` |
| 组件复用 | `ContextPathField` 泛化为接受 `label` / `hint` / `placeholder` props 并重命名为 `PathListField`，两处（参考资料、快捷链接）共用同一组件（Badge 列表 + SearchFileField），满足「使用参考资料所用组件」 |
| placeholder 措辞 | 快捷链接 placeholder 避免含「搜索 / 参考 / reference」字样，防 E2E `[placeholder*='参考']...first()` 选择器误命中（Base UI Tabs 默认卸载非激活 panel，两输入框不同时挂载，此处为双保险） |
| Header 布局 | 按钮行容器 `flex min-w-0 items-center gap-1 overflow-x-auto`（可收缩），防止链接多时把 `ml-auto` 的 close 按钮挤出视口；不同目录同名文件按钮文本相同（basename），`title` 全路径区分 |
| 主题钩子 | 新增 `data-chat-quick-links`（header 按钮行）与 `data-chat-quick-link-panel`（移动端面板），按 theming.md 同步契约同步模板 + skill |

## 契约

### profile.md frontmatter（数据文件）

```yaml
quickLinks:
  - notes/world.md
  - chars/hero.md
```

- core `AgentProfile` 加 `quickLinks?: string[]`（防御性过滤非 string 项，absent = undefined）
- renderer `AgentFormData` 加 `quickLinks: string[]`（absent 解析为 `[]`；build 时非空才写入 frontmatter）

### contracts `agentProfile` schema

```ts
quickLinks: Type.Optional(Type.Array(Type.String())),
```

## 各层实现

### core

1. `types.ts`：`AgentProfile` 加 `quickLinks?: string[]`
2. `store/agent-profile.ts` `parseFile`：`quickLinks: Array.isArray(data.quickLinks) ? data.quickLinks.filter((p): p is string => typeof p === "string") : undefined`

### contracts

3. `agents.ts`：`agentProfile` schema 加 `quickLinks`（镜像契约面，schema 与派生类型全导出规则不变）

### app — 配置侧

4. `features/agent-dialog/agent-markdown.ts`：`AgentFormData` 加 `quickLinks: string[]`；`parseAgentMarkdown` 解析（两处默认值分支都要补 `quickLinks: []`）；`buildAgentMarkdown` 非空写入
5. `features/agent-dialog/ContextPathField.tsx` → 重命名 `PathListField.tsx`：props 加 `label` / `hint` / `placeholder`（必传字符串，i18n 由调用方解析）
6. `AgentDialogForm.tsx`：
   - Tabs value `theme` → `personalization`，label 换 `t("agent-dialog.tabPersonalization")`
   - 「个性化」页顶部加 `PathListField`（quickLinks，add/remove handler 仿 context 去重逻辑）；主题 hint + textarea 保持
   - 「基本」页参考资料调用处改传 `t()` 三 props

### app — 消费侧

7. `queries/keys.ts`：加 `agent: (projectId, agentId) => ["projects", projectId, "agent", agentId]`
8. `queries/project/agents.ts`：加 `useProjectAgentProfile` hook（`client.getAgent`）；`updateProjectAgent` 成功后追加失效 detail key
9. `features/chat/Header.tsx`：props 加 `quickLinks?: string[]` / `activeQuickLink?: string | null` / `onQuickLink?: (path: string) => void`；agent name 与 close 按钮之间渲染按钮行（`data-chat-quick-links`，`overflow-x-auto` 容器，按钮 `variant={active ? "secondary" : "ghost"}`、`title` 全路径、文本 basename）
10. 新增 `features/chat/QuickLinkPanel.tsx`：移动端面板。`useContentFile` + `classifyFileKind` + `refreshKey`（仿 `FloatingContentBrowserContainer`），细 header（basename + X）+ `ContentView`；`data-chat-quick-link-panel` 钩子；文件加载失败走 ContentView error 态（不自动关闭，桌面浮窗的自动 closeFloat 逻辑不照搬）
11. `features/chat/index.tsx`：
    - `activeQuickLink` state + `handleQuickLink`（分流逻辑见决策表）
    - header 区改为 `{!hideHeader && (<div className="relative shrink-0"><Header .../>{面板}</div>)}`；面板仅 `isMobile && quickLinks.length > 0` 时渲染
    - `useProjectAgentProfile` 取 quickLinks（`enabled: !hideHeader`）

### i18n（zh-CN 基准，三语同步）

12. 新增：`agent-dialog.tabPersonalization`（个性化 / 個性化 / Personalization）、`agent-dialog.quickLinksLabel`（快捷链接）、`agent-dialog.quickLinksHint`（显示为聊天窗口顶部的按钮，点击可快速打开该文件）、`agent-dialog.quickLinksPlaceholder`（添加文件…，避开 E2E 选择器冲突字样）；删除 `agent-dialog.tabTheme`

### 主题钩子同步（theming.md 同步契约）

13. `docs/official/architecture/theming.md` DOM 入口表加两钩子
14. `packages/presets/templates/agent-theme-template.css` 加注释示例（`[data-chat-quick-links]` 按钮、`[data-chat-quick-link-panel]` 面板）+ 跑 sync 脚本再生成 dist
15. `packages/presets/skills/spherse-create-agent-chat-theme/SKILL.md` 选择器速查表补两行

## 测试

- core：`agent-profile.test.ts` quickLinks round-trip（含非 string 项过滤、absent → undefined）
- contracts：api-contracts 测试 agentProfile fixture 加 quickLinks
- server：`agents-routes.test.ts` FULL_PROFILE fixture 加 quickLinks，断言 `GET /agents/:id` 透传
- app：
  - `agent-markdown.test.ts`：parse/build round-trip、absent → `[]`、空数组不写入 frontmatter
  - `resolveQuickLinkAction` 纯函数单测：mobile → panel；desktop+floatEnabled → float；desktop+web → navigate
  - `Header.test.tsx`：quick link 按钮渲染（basename 文本、`data-chat-quick-links` 钩子）、点击回调、active 态
  - 新增 `QuickLinkPanel.test.tsx`：open 态渲染 + 关闭按钮回调 + `data-chat-quick-link-panel` 钩子
- E2E：`agent-dialog.spec.ts` 加一条 quickLinks round-trip：个性化 tab 配置快捷链接 → 保存 → 打开聊天 → header 出现按钮 → 点击出文件浮窗

## 风险与边界

- **E2E 选择器**：`agent-dialog.spec.ts` 的 `[placeholder*='参考']...first()` 与快捷链接 placeholder 并存安全（Base UI Tabs 默认卸载非激活 panel，两输入框不同时挂载；placeholder 措辞也已避开）；tab 改名后 E2E 等待的是「基本」tab 文本，不受影响
- **浮窗聊天无快捷链接**（已确认接受）：`hideHeader` 时不查 profile、不渲染按钮
- **web 桌面宽度降级为页面跳转**：与现有 float action 降级一致（`openFile` 同路径）
- **quickLinks 指向的文件被删**：桌面浮窗已有自动关闭逻辑；移动面板显示 ContentView error 态，用户手动关
- **quickLinks 路径无存在性/类型校验**：SearchFileField 回车可手输任意路径（含目录），quickLinks 不校验——与 context 字段行为一致，错误态可兜底
- **electron 窗口 resize 跨断点**：`useIsMobile` 响应式切换，面板 unmount、`activeQuickLink` 残留 state 无害（桌面分支不写入，仅移动 toggle 消费）
- **profile 外部编辑后聊天内不实时刷新**：quickLinks 是第一个被 renderer query 缓存的 profile 字段（`staleTime: Infinity`），外部编辑在 renderer 侧不刷新——接受；theming 域已有 ThemeQueryBridge「fs-watch → 失效 query」先例，可作后续演进路径

## E2E

影响 agent dialog 与 chat header：优先跑 `agent-dialog.spec.ts`（配置侧 round-trip + 新增 quickLinks 用例）与 chat 相关冒烟（header 结构变化）。

## 文档同步（doc-sync 清单）

- `docs/official/data-conventions.md`：profile frontmatter 字段表加 `quickLinks`
- `docs/official/project-structure.md`：按该文档实际列举粒度判断（当前只列到目录级，文件级重命名/新增可能无需改动）
- `docs/official/architecture/theming.md`：DOM 入口表加两钩子；「主题设置 UI」节「Agent Dialog 主题 tab」措辞随 tab 改名同步更新
- `packages/presets/templates/agent-theme-template.css` + agent-chat-theme skill：见上
