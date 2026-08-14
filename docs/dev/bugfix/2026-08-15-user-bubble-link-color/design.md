# 修复 chat 气泡内链接颜色不可读

- 日期：2026-08-15
- 状态：已实施（最终方案见 §7 复查修订：`linkClassName="text-inherit"`，两种 role 统一）
- 类型：bugfix（视觉/对比度）
- 影响范围：`packages/app`（chat / floating chat 共用的 `MessageItem`、共享组件 `MarkdownContent`）

## 1. 问题

聊天界面中，用户（user）消息气泡内的 markdown 链接不可见——链接颜色与气泡背景色完全相同。用户在消息中粘贴 URL 或写 `[text](url)` 时，只能看到下划线所在处一片「空缺」（下划线颜色走 `currentColor`，同样与背景同色），无法辨认链接文字，也无法意识到该处是可点击链接。

该问题在**所有主题下均复现**：默认 light/dark、项目级 `.spherse/theme.css`、agent 级主题均如此（原因见根因分析——token 配对结构决定了同色冲突是必然的）。

## 2. 根因分析

两个组件各自语义正确，组合后冲突：

1. **user 气泡**（`packages/app/src/features/chat/MessageItem.tsx:61`）：

   ```tsx
   isUser
     ? "bg-primary text-primary-foreground"
     : "border border-border bg-card text-card-foreground"
   ```

   user 气泡背景为 `--color-primary`，正文为 `--color-primary-foreground`（token 配对，二者天然互为前景/背景）。

2. **markdown 链接样式**（`packages/app/src/components/MarkdownContent.tsx`，`CHAT_COMPONENTS.a`（L113-115）与 `onLinkClick` 动态 override（L136-148）两处均为）：

   ```tsx
   <a className={cn("text-primary underline underline-offset-4", className)} ... />
   ```

   链接颜色被无条件硬编码为 `--color-primary`，不感知所在气泡的上下文。

3. **组合结果**：user 气泡内链接 = `text-primary` 文字 + `currentColor` 下划线，落在 `bg-primary` 背景上——前景与背景是**同一个 CSS 变量**，任何主题（无论 `--sp-primary` 取什么值）下都严格同色，链接完全不可见。`remark-gfm` 自动识别的裸 URL 链接走同一 `a` 渲染器，同样受影响。

不受影响的场景（`text-primary` 链接在这些背景下正常，保持不变）：

- assistant 气泡（`bg-card`）
- Content Browser 文档视图（`variant="document"`，`bg-background`）
- Settings 更新弹窗 release notes（`variant="chat"`，渲染在 card 表层）

## 3. 方案对比

### 方案 A（选定）：`MarkdownContent` 新增 `linkClassName` prop，调用方按上下文传入

`MarkdownContent` 新增可选 prop `linkClassName?: string`；`MessageItem` 对 user 消息传 `text-primary-foreground`，assistant 传 `undefined`（维持 `text-primary`）。经 `cn`（twMerge）合并，后传的 text-color 工具类覆盖基线的 `text-primary`。

- ✅ 语义 token（`text-primary-foreground`），符合「只用 shadcn 语义 token」规范；对比度由 token 配对保证，所有主题（默认/项目/agent/dark）自动正确
- ✅ 与既有上下文 prop 模式一致（`breaks` 已按 `isUser` 传递，先例见 backlog 2026-08-09 chat polish）
- ✅ twMerge 覆盖基线工具类有先例（Composer `md:text-sm` 字号修复）
- ✅ 特异性仅单个 class（0,1,0），用户主题用 `[data-chat-bubble] a`（0,1,1）后代选择器仍可覆盖，不破坏主题生态
- ✅ 其它三个消费方（document 视图、UpdateChecker、assistant 气泡）零影响
- ⚠️ 需穿透 2 个文件；未来若有新组件渲染 user 气泡内容需记得传参（当前唯一入口是 `MessageItem`，chat 页与 floating chat 共用）

### 方案 B（否决）：`styles.css` 基础样式后代选择器

```css
[data-chat-message][data-role="user"] [data-chat-bubble] a {
  color: var(--color-primary-foreground);
}
```

- ✅ 零 JSX 改动，一处覆盖所有渲染路径
- ❌ 裸 CSS 后代选择器绕过 Tailwind utility 心智模型（编码规范倾向不写原生 CSS class 的等价问题）
- ❌ 特异性 (0,2,1) 偏高，主题作者需写更强选择器才能覆盖链接色，对主题生态不友好

### 方案 C（否决）：chat 链接一律改为 `text-inherit`

- ✅ 规则最简（「链接 = 正文色 + 下划线」）
- ❌ assistant 气泡与 UpdateChecker 的链接失去 primary 强调色，属于超出 bug 修复范围的可视行为变化；且与 document 视图（仍 `text-primary`）不一致

## 4. 详细设计（方案 A）

### 4.1 `MarkdownContent.tsx`

1. Props 接口新增：

   ```tsx
   linkClassName?: string;
   ```

2. 动态 `a` override 的构建条件从 `if (onLinkClick)` 扩为 `if (onLinkClick || linkClassName)`，使 prop 不依赖 `onLinkClick` 也能独立生效；className 合并为：

   ```tsx
   className={cn("text-primary underline underline-offset-4", linkClassName, className)}
   ```

   合并顺序：基线 → `linkClassName`（上下文覆盖）→ `className`（react-markdown 透传，通常为空）。twMerge 保证 `linkClassName` 中的 text-color 工具类正确替换基线 `text-primary`，`underline`/`underline-offset-4` 不受影响继续生效。

3. `onClick` 逻辑保持不变：未传 `onLinkClick` 时不挂自定义 handler（守卫 `if (!onLinkClick || !href) return`）。

4. 静态 `CHAT_COMPONENTS.a` / `DOCUMENT_COMPONENTS.a` 不改——chat 页 `MessageItem` 恒传 `onLinkClick`，动态 override 必然生效；静态表仅作为无 prop 时的兜底，其 `text-primary` 在无覆盖上下文中是正确默认。

### 4.2 `MessageItem.tsx`

```tsx
<MarkdownContent
  variant="chat"
  breaks={isUser}
  linkClassName={isUser ? "text-primary-foreground" : undefined}
  onLinkClick={handleLinkClick}
>
```

- user 气泡链接：`text-primary-foreground underline underline-offset-4`——与气泡正文同色，可读性与正文一致；下划线保留链接可供性（affordance）
- assistant 气泡链接：不变（`text-primary`）
- floating chat 复用 `MessageItem`，自动获得修复

### 4.3 主题兼容性

- 未新增/变更任何 CSS token、`data-*` 主题钩子、DOM 结构，按 AGENTS.md 维护契约**无需**更新 `create-ui-theme` / `create-agent-chat-theme` skill、`agent-theme-template.css` 与 `docs/official/architecture.md`
- 主题作者如需自定义 user 气泡链接色，现有手段依然有效且优先级高于本修复：`[data-chat-bubble] a { color: … }`（(0,1,1) > 工具类 (0,1,0)）

## 5. 测试计划

组件渲染级测试工具链尚未落地（backlog「React DOM 组件测试工具链」），沿用现有 structure test 模式：

1. `MessageItem.structure.test.ts` 新增 case：断言源码包含 `linkClassName={isUser ? "text-primary-foreground" : undefined}`（防止回归到硬编码）
2. 新建 `MarkdownContent.structure.test.ts`：断言
   - props 接口含 `linkClassName`
   - 动态 override 条件为 `onLinkClick || linkClassName`（prop 可独立生效）
   - `cn("text-primary underline underline-offset-4", linkClassName` 合并顺序（twMerge 后者胜出）

验证命令：`npm test --workspace=packages/app` + `npm run lint --workspace=packages/app`。不涉及 Electron 启动/store/server API，按影响面选择原则无需跑 E2E。

## 6. 边界与非目标

- **非目标**：链接 hover 态（现状全应用均无 hover 样式，YAGNI）；assistant/document 链接样式调整；新增 `data-md-link` 主题钩子（如未来需要再立项，届时按契约同步 skill 文档）
- `SendFailedBar`、`MessageAttachments` 渲染在气泡外部/非 markdown，不受影响
- i18n：无新用户文案，不涉及
- 回滚：改动集中在 2 个源文件 + 2 个测试文件，单一 commit 可直接 revert

## 7. 复查修订（同日）：assistant 气泡链接同样不可读，方案值改为 `text-inherit`

用户反馈 assistant 气泡链接也有问题。系统排查（systematic-debugging）后修订结论，**机制不变（`linkClassName` prop），传入值从 `text-primary-foreground`（仅 user）改为 `text-inherit`（两种 role 统一）**。

### 7.1 新证据

1. **agent 主题注入作用域**（`features/chat/index.tsx:72`）：主题 `<link>` 挂在 `[data-chat-root]` 内部，主题可以同时——① 覆盖 token（`--sp-primary` 等）；② 用 `[data-role=...] [data-chat-bubble] { background, color }` **直接重绘气泡**。示例主题「冥想盆」两者都做了：assistant 气泡重绘为近白/深棕并自设正文色，user 气泡重绘为红色渐变。
2. **根因升级**：链接色绑定 `--sp-primary`，但 agent 主题把 primary 调成「金色点缀」（为按钮/装饰服务），与重绘后的气泡背景无任何保证关系——链接对比度无人负责。原 §2 的「token 配对保证对比度」假设**只在不重绘气泡的主题下成立**。
3. **对比度实测**（WCAG，正文 4.5:1）：
   - 冥想盆 light：assistant 链接 `#b8862a` on 近白气泡 = **3.12 ❌**（用户报告坐实）
   - 冥想盆 dark：初版修复 `primary-foreground #1c1212` on user 红渐变 = **2.46 ❌**（初版修复在该主题下反而劣化——`--sp-primary-foreground` 配的是金色 primary，与红渐变气泡无关）
   - `text-inherit`（= 气泡正文色）：全部组合 4.4~16.3 ✅（恒等于正文自身对比度）
4. **默认主题零视觉变化**：默认 light `--sp-primary #171717` ≡ `--sp-foreground`，dark `#fafafa` ≡ `#fafafa`——inherit 与原 primary 链接同色，仅保留下划线。

### 7.2 为什么原「方案 C 否决理由」不成立

§3 否决 C 的理由是「assistant 链接失去 primary 强调色，超出 bug 范围」。复查表明：**任何固定 token（primary / primary-foreground）都会被「重绘气泡」的主题解耦**，唯一跨主题健壮的不变量是气泡正文色（主题作者必须保证正文可读，否则整个气泡都是坏的）。链接继承正文色 + 下划线可供性，是唯一不依赖主题作者自觉的方案。代价：项目主题下 chat 气泡内 assistant 链接失去强调色（如格兰芬多亮色的猩红链接变为正文深棕）——用下划线补偿，可接受。

### 7.3 影响面

- chat / floating chat 气泡内所有 markdown 链接（user + assistant）
- 不变：document 视图（`variant="document"`，不在 `[data-chat-root]` 内，agent 主题不波及）、UpdateChecker（chat 静态表 `text-primary`，在 card 表层）、裸 `<a>` 以外的元素
- 测试同步：`MessageItem.structure.test.ts` 断言改为 `linkClassName="text-inherit"` 且不含旧值
