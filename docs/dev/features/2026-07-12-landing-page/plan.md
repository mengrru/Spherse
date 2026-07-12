# Landing Page 实施计划

## Task 1: Scaffold landing package 基础设施

**目标**：创建 `packages/landing` package 骨架，可启动 dev server。

**步骤**：
1. 创建 `packages/landing/package.json`（依赖见 design.md）
2. 创建 `vite.config.ts`（`base: "/Spherse/"`，plugins: react + tailwindcss，alias `@` → `src`）
3. 创建 `tsconfig.json`（继承 root `tsconfig.base.json`）
4. 创建 `index.html` 入口
5. 创建 `src/main.tsx` + `src/App.tsx`（先渲染一个 hello world）
6. 创建 `src/styles.css`（从 `packages/app/src/styles.css` 复制精简：保留 `@import`、`:root` token、`@theme inline` 映射、`@layer base` 基础样式）
7. 创建 `src/lib/utils.ts`（从 app 复制 `cn()`）
8. 在 root `package.json` 添加 `dev:landing` 和 `build:landing` 脚本
9. 更新 root `eslint.config.js` 覆盖 `packages/landing`

**验证**：`npm run dev:landing` 能启动，页面显示 hello world，Tailwind 类名生效。

---

## Task 2: i18n 基础设施

**目标**：landing 三语切换可用。

**步骤**：
1. 创建 `src/i18n/locales/zh-CN.ts`（canonical，带注释）
2. 创建 `src/i18n/locales/zh-TW.ts`
3. 创建 `src/i18n/locales/en.ts`
4. 创建 `src/i18n/index.ts`：`useLandingI18n` hook（localStorage 持久化 + `normalizeLocale(navigator.language)` 首次探测）
5. 创建 `src/components/LanguageSwitcher.tsx`（右上角三语按钮）

**翻译 key 清单**：
- `hero.title`、`hero.subtitle`
- `hero.downloadMac`、`hero.downloadWin`
- `feature.local.title` / `feature.local.desc`
- `feature.agents.title` / `feature.agents.desc`
- `feature.trigger.title` / `feature.trigger.desc`
- `feature.theme.title` / `feature.theme.desc`
- `upcoming.memory.title` / `upcoming.memory.desc`
- `upcoming.mcp.title` / `upcoming.mcp.desc`
- `lang.zhCN` / `lang.zhTW` / `lang.en`

**验证**：切换语言时所有文案实时更新，刷新页面后 locale 保持。

---

## Task 3: 复制 shadcn 组件

**目标**：landing 内有可用的 Button 和 Dialog。

**步骤**：
1. 复制 `packages/app/src/components/ui/button.tsx` → `packages/landing/src/components/ui/button.tsx`，调整 base 尺寸适配 web 场景（landing 的按钮比 app 内更大，如 `h-10` / `h-11`）
2. 复制 `packages/app/src/components/ui/dialog.tsx` → `packages/landing/src/components/ui/dialog.tsx`，调整 `DialogContent` 默认 `max-w` 为 `max-w-3xl`

**验证**：Button 和 Dialog 能正常渲染和交互。

---

## Task 4: 页面组件实现

**目标**：完成 Hero、Footer、UpcomingFeatures、FeatureCards、FeatureModal 组件。

**步骤**：
1. `src/components/Hero.tsx`：标题 + 副标题 + 两个下载按钮（占位 `#`）
2. `src/components/Footer.tsx`：`Spherse@2026`
3. `src/components/UpcomingFeatures.tsx`：2 个虚线边框卡片（跨 session 记忆 + MCP）
4. `src/data/features.ts`：feature 配置数据
5. `src/components/FeatureModal.tsx`：横向滚动截图浮层
6. `src/components/FeatureCards.tsx`：4 列网格（响应式 2 列 / 1 列），点击打开 FeatureModal
7. 在 `src/App.tsx` 组合以上组件 + LanguageSwitcher

**验证**：页面布局完整，feature card 点击打开浮层，响应式适配正常。

---

## Task 5: 轮播组件

**目标**：完成 Carousel 组件，含锚定按钮对齐、主题切换、自动播放。

**步骤**：
1. `src/data/slides.ts`：4 张 slide 配置
2. 创建 placeholder 截图和 theme CSS 文件到 `public/`（占位图 + 占位 CSS）
3. `src/components/Carousel.tsx`：
   - 截图容器 `position: relative`
   - 锚定按钮列竖向叠加在 avatar 位置（`size-9`、`rounded-lg`、透明 + active 发光描边）
   - 主题切换：`<link>` 动态加载/移除
   - 自动播放：5 秒 `setInterval` + 点击重置 + `IntersectionObserver` 暂停
   - 响应式：移动端锚定按钮缩小
4. 在 `src/App.tsx` 中集成 Carousel

**验证**：轮播自动播放、点击锚定按钮切换、主题色随切换改变、不可见时暂停。

---

## Task 6: 响应式适配

**目标**：全页面移动端基本可用。

**步骤**：
1. Hero 区：移动端标题/按钮缩小
2. 轮播：锚定按钮等比缩小，位置微调
3. FeatureCards：4 列 → 2 列 → 1 列
4. UpcomingFeatures：2 列 → 1 列
5. LanguageSwitcher：移动端紧凑布局

**验证**：在窄屏（375px）下各区域不溢出、可交互。

---

## Task 7: 部署配置

**目标**：GitHub Actions 自动部署 landing 到 GitHub Pages。

**步骤**：
1. 创建 `.github/workflows/deploy-landing.yml`
2. 确认 `npm run build:landing` 构建成功（含 `@spherse/i18n` 依赖构建）
3. 确保 `packages/landing/dist/` 产物正确（base 路径 `/Spherse/`）

**验证**：push 到 main（含 landing 变更）后 CI 触发，gh-pages 分支更新。

---

## Task 8: 文档更新

**目标**：README、AGENTS.md、project-structure.md、backlog.md 同步更新。

**步骤**：
1. 编写 `README.md`（纯中文）
2. 翻译为 `README.en.md`
3. 更新 `AGENTS.md` 开头产品描述
4. 更新 `docs/official/project-structure.md` 新增 `packages/landing/` 索引
5. 更新 `docs/dev/backlog.md` 新增/标记 landing page 条目

**验证**：文档与代码一致，无过时描述。

---

## Task 依赖关系

```
Task 1 (scaffold) ──┬── Task 2 (i18n) ──┐
                     ├── Task 3 (ui) ────┤
                     │                    ├── Task 4 (page components) ──┐
                     │                    └── Task 5 (carousel) ─────────┤
                     │                                                     ├── Task 6 (responsive)
                     │                                                     └── Task 7 (deploy)
                     └────────────────────────────────── Task 8 (docs) 可并行
```

Task 1 是前置；Task 2 和 Task 3 互相独立可并行；Task 4 和 Task 5 依赖 2+3；Task 6 依赖 4+5；Task 7 依赖 1；Task 8 全程可并行。
