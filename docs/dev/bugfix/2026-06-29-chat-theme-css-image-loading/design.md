# [Bugfix] chat 专用主题 CSS 中引用的图片无法载入

## 问题描述

在 agent chat 专用主题（`.spherse/agents/{slug}-{shortId}/theme.css`）中，如果 CSS 通过 `url(...)` 引用了本地图片，图片会因路径问题无法载入（控制台 404）。项目级主题（`.spherse/theme.css`）引用同样的图片则正常。

## 根因分析

### 关键差异：CSS 的「载入方式」不同，导致相对 `url()` 的解析基址不同

按 CSS 规范，相对 `url()` 的解析基址取决于 CSS 文本「住在哪」：

| CSS 来源 | 相对 `url()` 的解析基址 |
|----------|--------------------------|
| `<link rel="stylesheet" href="...">` | 该样式表自身的 URL（去掉文件名、去掉 query） |
| 内联 `<style>...</style>` | 渲染文档的 `document.baseURI` |

**项目级主题（正常）**：以 `<link>` 注入，`href` 指向项目文件服务树内部：

- `packages/app/src/hooks/useCustomTheme.ts:16`
  ```ts
  link.href = `${baseUrl}/api/projects/${projectId}/preview/.spherse/theme.css?t=${Date.now()}`;
  ```
  解析基址 = `.../preview/.spherse/`。于是 `url(bg.png)` → `.../preview/.spherse/bg.png`、`url(../assets/bg.png)` → `.../preview/assets/bg.png`，都命中 preview 路由（`packages/server/src/routes/preview.ts:29`，同时服务 `.css` 与 png/jpg/svg/webp/... ），图片正常载入。

**Agent chat 主题（异常）**：以原始文本形式 fetch 后注入为内联 `<style>`：

- `packages/app/src/features/chat/hooks/useAgentTheme.ts:16` 调用 `client.getAgentTheme(agentId)`（`packages/app/src/lib/api.ts:200`，`.text()`）
- `packages/app/src/features/chat/index.tsx:41` 与 `packages/app/src/features/floating-chat/FloatingChatContainer.tsx:69` 直接渲染：
  ```tsx
  {themeCss && <style>{themeCss}</style>}
  ```
  此时 `url()` 的解析基址 = 渲染文档的 `document.baseURI`。渲染器由 `packages/app/electron/window.ts:21-25` 加载（dev = Vite origin `http://localhost:5173/`，prod = `file://.../renderer/index.html`），路由为 hash router（`packages/app/src/router.tsx`，无 `<base>` 标签）。这两个 origin 都与项目文件毫无关系，于是无论写相对路径还是根绝对路径（`url(/x.png)`）都 404。

  > 即便把内联 `<style>` 换成 `<link href=".../agents/:id/theme">`，相对 `url()` 会解析到 `.../agents/:id/bg.png`，而该路径不是已注册路由，仍然 404——必须锚定到 preview 路由才行。

### 同类先例（已修复）

聊天 HTML card 曾是同一个根因：chat 用 `<iframe srcDoc={html}>`（origin `null`，相对路径不可解析），content browser 用 `<iframe src={previewUrl}>`（真实 HTTP URL，相对路径正常解析）。修复方案是当 card 有 `file_path` 时改用 `<iframe src={client.getPreviewUrl(card.file_path)}>`。参见 `docs/dev/features/2026-06-24-ux-optimization-round1/design.md`，落地于 `packages/app/src/features/chat/HtmlCard.tsx:85`。

本次 chat 主题图片问题是同一模式、尚未修复的那一半：项目主题 = 「锚定到 preview URL」（正常）；chat 主题 = 「内联文本注入」（异常）。

### 额外发现：FloatingChatContainer 存在冗余的主题处理

`FloatingChatContainer.tsx` 内部已经渲染了 `<Chat>`（`:78`），而 `<Chat>` 自身会调用 `useAgentTheme` 处理主题。但 `FloatingChatContainer.tsx:28-47,69` 又**重复** fetch 了一遍主题 CSS 并渲染第二个 `<style>`。属于既有冗余，本次一并清理。

## 修复方案

**总思路（Option A）**：与项目级主题、HTML card 先例保持一致——把 agent 主题从「内联文本 `<style>`」改为「锚定到 preview 路由的 `<link>`」，使相对 `url()` 自然解析进项目文件服务树。无需改动 server / API contract。

### 改动 1：`useAgentTheme` 改为返回主题 `<link>` 的 href

文件：`packages/app/src/features/chat/hooks/useAgentTheme.ts`

- 签名增加 `slug`：`useAgentTheme(client, agentId, slug, projectId)`。
- 不再 `getAgentTheme()` 取文本，改为构造 preview URL。注意：`AgentProfile.slug` **本身就是 agent 目录名**（`AgentStore` 构造时用 `path.basename(agentDir)` 作为 slug，见 `packages/core/src/store/agent-store.ts:23`；`loadAgents` 也传 `entry.name`，见 `project.ts:101`；`parseFile` 返回 `slug: this.slug`，无 frontmatter 覆盖）。因此直接用 `slug` 作为目录名，**不要**再拼接 shortId（拼接会导致旧式无 shortId 目录的 agent 路径错误，也会给新 agent 重复后缀）。复用现成 helper：
  ```ts
  const themeHref = `${client.getPreviewUrl(`.spherse/agents/${slug}/theme.css`)}?t=${ts}`;
  // client.getPreviewUrl 见 lib/api.ts:256 → `${apiBase}/preview/${filePath}`
  ```
- 返回带缓存破坏 query 的 href：`${base}?t=${ts}`。`ts` 维持为组件内 state。
- fs-watch 热重载逻辑保留：监听 `agents/.../theme.css` 变化（现有过滤条件不变），变化时 `setTs(Date.now())` 触发 href 更新，从而让 `<link>` 重新拉取。
- 返回值由 `string | null`（CSS 文本）改为 `string`（href）。

### 改动 2：`Chat` 用 `<link>` 取代内联 `<style>`

文件：`packages/app/src/features/chat/index.tsx`

- `:33` 改为 `const themeHref = useAgentTheme(client, agent.id, agent.slug, projectId);`
- `:41` 将 `{themeCss && <style>{themeCss}</style>}` 替换为：
  ```tsx
  {themeHref && <link rel="stylesheet" href={themeHref} />}
  ```

### 改动 3：`FloatingChatContainer` 移除冗余主题处理

文件：`packages/app/src/features/floating-chat/FloatingChatContainer.tsx`

- 删除 `themeCss` state、`timerRef`、独立的 `getAgentTheme` fetch、`fs-watch` 订阅与清理 effect（`:25-26, 28-53`），以及 `:69` 的 `<style>`。
- 浮窗内已渲染 `<Chat>`（`hideHeader`），主题由 `<Chat>` 内的 `useAgentTheme` 统一负责。agent 主题 CSS 选择器以 `[data-chat-root]` 为根（见 `create-agent-chat-theme` SKILL），浮窗外层 chrome 本就不被 agent 主题作用，移除无损。

### 改动 4：更新 `create-agent-chat-theme` Skill 文档

文件：`packages/presets/skills/create-agent-chat-theme/SKILL.md`

当前文档声明「`<style>` 标签会直接注入原始 CSS 文本，不做任何转换」（`:12`），修复后此描述不再准确。需：

1. 更正载入机制描述：主题以 `<link rel="stylesheet">` 形式从 preview 路由载入（与项目级主题一致）。
2. 补充图片/字体引用指引：相对 `url()` 现在可以正常工作，推荐将素材放在 agent 目录（`.spherse/agents/{slug}-{shortId}/`）下用相对路径引用（如 `url(./bg.png)`），或用 `../...` 引用项目内其它位置的文件。

> 依据 AGENTS.md「用户主题 Skill 维护」规则：主题载入机制变更时必须同步更新对应 skill 文档。

## 备选方案（及为何不采用）

- **A′：server 在 `AgentProfile` contract 中暴露项目相对主题路径（或主题 preview URL）**，客户端直接 `<link>` 该 URL，避免在客户端重建 `{slug}-{shortId}` 命名约定。更鲁棒（server 为唯一事实源），但需改动 core 类型 + server contract schema + 客户端，爆炸半径大于纯客户端修复。命名约定短期内稳定，先采用 Option A；若将来 agent 目录命名规则可能变化，再迁移到 A′。
- **B：保留内联 `<style>` 文本注入，在注入前解析并改写 CSS 中的相对 `url()` 为绝对 preview URL**。不改载入机制，但需要稳健的 CSS `url()` 改写器（需正确处理引号、`data:`、`@font-face`、`#hash`、多行等），代码量大、正则脆弱、测试面广。与既有的 `<link>` 模式不一致，放弃。

## 行为变化

| 场景 | 修改前 | 修改后 |
|------|--------|--------|
| chat 主题 CSS 引用相对路径图片 | 404，图片不显示 | 正常显示（经 preview 路由解析） |
| chat 主题 CSS 引用 `../` 跨目录素材 | 404 | 正常显示 |
| chat 主题 CSS 引用远程 URL（`https://...`） | 正常 | 不变 |
| chat 主题无 `theme.css`（空主题） | 不注入 `<style>` | `<link>` 指向不存在的文件，preview 返回 404，浏览器静默忽略（与项目级主题 `useCustomTheme` 的 `onerror` 行为一致，仅 dev 控制台一条告警） |
| 主题文件保存后热重载 | fs-watch 触发重新 fetch 文本 | fs-watch 触发 `ts` 变化 → `<link href>` 更新 → 重新拉取 |
| 浮窗（floating chat）主题 | `FloatingChatContainer` 与 `<Chat>` 各注入一份重复 `<style>` | 仅 `<Chat>` 注入一份 `<link>`，消除冗余 |

## 已知边界 / 限制

- **命名约定耦合**：客户端需重建 `{slug}-${id.slice(0,6)}` 目录名（与 `packages/core/src/store/project.ts:152-156` 一致）。若未来 core 改变该命名规则，需同步本 hook 或迁移到备选方案 A′。
- **同时存在多个不同 agent 的活动 chat**：`<link>` 对整个文档生效。若 docked chat（agent A）与浮窗 chat（agent B）同时存在且主题选择器重叠，后载入者覆盖前者——与当前内联 `<style>` 行为一致，非本次回归。实际场景中浮窗通常对应当前活跃 agent，影响可忽略。

## 影响范围

- `packages/app/src/features/chat/hooks/useAgentTheme.ts` — 改为返回 href（preview 路由 + 缓存破坏 query），保留 fs-watch 热重载
- `packages/app/src/features/chat/index.tsx` — `<style>` → `<link>`，传入 `agent.slug`
- `packages/app/src/features/floating-chat/FloatingChatContainer.tsx` — 移除冗余主题 fetch / `<style>`
- `packages/presets/skills/create-agent-chat-theme/SKILL.md` — 更正载入机制描述 + 补充图片引用指引
- 保留不动：`client.getAgentTheme`（`packages/app/src/lib/api.ts:200`）、server 端 `/api/projects/:projectId/agents/:id/theme` 路由（`packages/server/src/routes/agents.ts:38-44`）、`projectManager.getAgentTheme`（`packages/core/src/project-manager.ts:69`）。原因：`AgentDialog.tsx:38` 的主题编辑器仍需以文本形式载入主题用于编辑，文本接口不可删除

## 验证方式

1. 在某 agent 目录放置 `theme.css` 与一张 `bg.png`，CSS 中写 `[data-chat-root] { background-image: url(./bg.png); }`，打开该 agent 的 chat → 背景图正常显示。
2. `url(../welcome.png)` 引用项目根目录图片 → 正常显示。
3. 远程 `url(https://example.com/x.png)` → 不受影响，正常显示。
4. 编辑 `theme.css` 并保存 → chat 外观热更新（fs-watch → `<link>` 重新拉取）。
5. 切换到另一个 agent → 主题随之切换（`agentId`/`slug` 变化 → href 变化 → `<link>` 更新）。
6. 打开浮窗 chat → 主题生效，且控制台只有一份主题 `<link>`（无重复）。
7. 对照项目级主题（`.spherse/theme.css`）同样引用图片 → 两者表现一致。
