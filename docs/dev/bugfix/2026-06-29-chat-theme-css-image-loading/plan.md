# [Bugfix] chat 专用主题 CSS 图片无法载入 — 实施计划

> **For agentic workers:** 适合 subagent-driven-development 模式逐 task 实现。Steps 用 checkbox（`- [ ]`）跟踪。

**Goal:** 让 agent chat 主题 CSS 中的相对 `url()` 引用（图片/字体）能正常解析到项目文件，与项目级主题行为一致。

**Design doc:** `docs/dev/bugfix/2026-06-29-chat-theme-css-image-loading/design.md`

**核心思路:** 把 agent 主题从「内联 `<style>{text}</style>`」改为「锚定到 preview 路由的 `<link rel="stylesheet">`」，使相对 `url()` 解析进 `/preview/*` 文件服务树。纯客户端改动，无 server/contract 变更。

**关键约定（实现时必须遵守）:**

- agent 目录名 = `AgentProfile.slug`（`slug` 本身就是目录名：`AgentStore` 用 `path.basename(agentDir)` 作 slug，`agent-store.ts:23`；`loadAgents` 传 `entry.name`，`project.ts:101`）。直接用 `slug`，**不要**再拼 `${agentId.slice(0,6)}`（拼接会导致 404：旧式无 shortId 目录路径错误，新 agent 会得到双后缀）
- preview URL 复用 `client.getPreviewUrl(relPath)`（`packages/app/src/lib/api.ts:256`，内部 = `${apiBase}/preview/${filePath}`，其中 `apiBase = ${baseUrl}/api/projects/${projectId}`）
- preview 路由同时服务 `.css` 与 png/jpg/svg/webp/woff... （`packages/server/src/routes/preview.ts:8-27`），所以锚定后图片自然可达
- **保留** `client.getAgentTheme` / server `/agents/:id/theme` 路由 / `projectManager.getAgentTheme`：`AgentDialog.tsx:38` 的主题编辑器仍需以文本形式载入主题用于编辑，**不可删除**

---

### Task 1: 重构 `useAgentTheme` hook + 更新 `Chat` 消费者

> 核心、内聚单元。hook 返回值类型变化（CSS 文本 → href），与消费者强耦合，须同一 subagent 一次完成。**阻塞** Task 2 的验证。

**Files:**
- Modify: `packages/app/src/features/chat/hooks/useAgentTheme.ts`
- Modify: `packages/app/src/features/chat/index.tsx`

- [ ] **Step 1: 改写 `useAgentTheme` 返回 href 而非 CSS 文本**

  `packages/app/src/features/chat/hooks/useAgentTheme.ts`：
  - 签名改为 `useAgentTheme(client, agentId, slug, projectId)`（新增 `slug` 参数）
  - 删除 `themeCss`/`setThemeCss`/`reqIdRef` 及 `getAgentTheme()` 文本拉取逻辑
  - 用 `ts` state 持有缓存破坏时间戳，初值 `Date.now()`
  - 构造 href（`slug` 即目录名，直接用，**不要**拼接 shortId）：
    ```ts
    const themeHref = `${client.getPreviewUrl(`.spherse/agents/${slug}/theme.css`)}?t=${ts}`;
    ```
  - fs-watch 订阅保留：过滤条件不变（`changedPath.includes("agents/") && changedPath.endsWith("theme.css")`），命中时 `setTs(Date.now())` 触发 href 变化
  - 返回 `themeHref`（`string`）。当 `client`/`agentId`/`slug` 缺失时早返回空串或抛错按现有 hook 风格处理（参考现有 `if (!client || !agentId) return;`，返回 `""`）

- [ ] **Step 2: `Chat` 用 `<link>` 取代内联 `<style>`**

  `packages/app/src/features/chat/index.tsx`：
  - `:33` 改为 `const themeHref = useAgentTheme(client, agent.id, agent.slug, projectId);`
  - `:41` 将 `{themeCss && <style>{themeCss}</style>}` 替换为：
    ```tsx
    {themeHref && <link rel="stylesheet" href={themeHref} />}
    ```

---

### Task 2: 清理 `FloatingChatContainer` 冗余主题处理

> 纯删除，与 Task 1 文件不重叠，**可并行**。`FloatingChatContainer` 已渲染 `<Chat>`（`:78`，`hideHeader`），主题由其内部 `useAgentTheme` 统一负责。

**Files:**
- Modify: `packages/app/src/features/floating-chat/FloatingChatContainer.tsx`

- [ ] **Step 1: 移除冗余主题 state / fetch / fs-watch / `<style>`**

  删除：
  - `themeCss`/`setThemeCss` state（`:25`）
  - `timerRef`（`:26`）
  - 独立的 `getAgentTheme` fetch effect（`:28-35`）
  - `fs-watch` 订阅（`:37-47`）
  - 清理 effect（`:49-53`）
  - `:69` 的 `{themeCss && <style>{themeCss}</style>}`

  保留：`projectId`（仍可能被其它逻辑用，核对后若变 unused 再删 import）、`Chat` 渲染、浮窗 chrome。清理后若 `useState`/`useRef`/`useEffect`/`useBusSubscription` 变为未使用，移除对应 import。

---

### Task 3: 更新 `create-agent-chat-theme` SKILL 文档

> 独立、**可并行**。载入机制描述需与代码同步（AGENTS.md「用户主题 Skill 维护」规则）。

**Files:**
- Modify: `packages/presets/skills/create-agent-chat-theme/SKILL.md`

- [ ] **Step 1: 更正载入机制描述**

  - `:12`（「写法：原生 CSS Nesting」段）：把「`<style>` 标签会直接注入原始 CSS 文本，**不做任何转换**」改为说明主题以 `<link rel="stylesheet">` 从 preview 路由载入（与项目级主题一致）。原生 CSS nesting 说明保留（仍成立）。
  - `:33`（层叠关系第 3 条）：「后注入的 `<style>` in chat 容器」→ 「chat 容器内后载入的 `<link>`」。
  - `:35`（优先级原理）：把「agent theme 的 `<style>` 在 DOM 中比 project theme 的 `<link>` 更靠后」更新为「agent theme 的 `<link>` 在 DOM 中（chat 容器内）比 project theme 的 `<link>`（document.head）更靠后」。原理不变（DOM 顺序决定层叠），仅措辞。

- [ ] **Step 2: 补充图片/字体引用指引**

  在「示例」段（`:81` 附近）之前或「常见错误」段新增一小节，说明：
  - 主题以 `<link>` 从 preview 路由载入，相对 `url()` 解析基址为 agent 目录 `.spherse/agents/{slug}-{shortId}/`
  - 推荐把素材放进 agent 目录，用 `url(./bg.png)` 引用；或用 `url(../assets/x.png)` 引用项目内其它文件
  - 远程 URL（`https://...`）照常工作

---

### Task 4: 验证

- [ ] **Step 1: Lint + 类型检查**

  Run: `npm run lint --workspace=packages/app && npm run lint --workspace=packages/presets`
  Expected: 无 error。（若 hook 签名/调用点有未对齐会在此暴露）

- [ ] **Step 2: 构建**

  Run: `npm run build --workspace=packages/app`
  Expected: 构建成功。

- [ ] **Step 3: 手动验证图片载入（核心场景）**

  Run: `npm run dev`
  1. 在某 agent 目录放 `theme.css` + `bg.png`，CSS 写 `[data-chat-root] { background-image: url(./bg.png); }` → 打开该 agent chat → 背景图显示
  2. `url(../welcome.png)` 引用项目根图片 → 显示
  3. 远程 `url(https://...)` → 不受影响
  4. 编辑 `theme.css` 保存 → fs-watch 热更新
  5. 切换 agent → 主题随之切换
  6. 打开浮窗 chat → 主题生效，控制台仅一份主题 `<link>`（无重复 `<style>`）
  7. 对照项目级主题 `.spherse/theme.css` 引用图片 → 行为一致

---

## Task 依赖与并行策略（subagent-driven）

```
Task 1 (核心: hook + Chat) ──┬──> Task 4 (验证，须在 1/2/3 全完成后)
                             │
Task 2 (清理 FloatingChat) ──┤   [可与 Task 1 并行：不同文件，纯删除]
                             │
Task 3 (SKILL.md 文档) ──────┘   [可与 Task 1/2 并行：独立文件]
```

- **可并行批：** Task 1 / Task 2 / Task 3 三者文件互不重叠，可派 3 个 subagent 并行
- **串行：** Task 4 在前三者完成后统一验证
- **风险点：** Task 1 hook 签名变化须同步 `chat/index.tsx` 调用点（同 task 内完成，无跨 task 依赖）；Task 2 删除后须确认 `FloatingChatContainer` 无 unused import（lint 会捕获）

## 不做的事（YAGNI）

- 不改 server / API contract / core（`getAgentTheme` 文本接口保留，供 `AgentDialog` 编辑器使用）
- 不引入 CSS `url()` 改写器
- 不重构 agent 目录命名约定（保留客户端重建 `{slug}-{shortId}` 的耦合，将来若 core 改命名规则再迁移到 server 暴露路径的方案）
