# Landing Page 设计文档

## 概述

为 Spherse 创建项目介绍页（landing page），通过 GitHub Pages 部署。同时更新 AGENTS.md 简介和编写 README。

产品定位调整：从「一个全平台、本地运行、开箱即用的 AI 辅助世界观创作桌面工具」改为「一个本地运行、开箱即用的AI辅助文字创作与演绎的桌面工具」。产品不局限于世界观创作，而是提供基础运行框架与核心功能，支持用户不同的文字创作需求（世界观创作、角色扮演、个人生活记录台等）。

## 范围

### 包含

1. **README 编写**：纯中文，写好后翻译为英文（`README.en.md`）
2. **AGENTS.md 简介更新**：调整产品定位描述
3. **Landing page**（`packages/landing`）：
   - Hero 区：标题 + 副标题 + macOS/Windows 下载按钮（先占位 `#`）
   - 轮播区：4 张不同项目的 APP 界面截图，自动播放（5 秒）+ 锚定按钮切换，切换时全局主题配色随之改变
   - 特性卡片：4 张，点击打开浮层展示该特性的若干张截图（横向滚动，数量各自不同）
   - 即将到来的功能：2 个（Agent 跨 Session 记忆、连接器 MCP）
   - 语言切换：右上角，三语（zh-CN / zh-TW / en）
   - Footer：`Spherse@2026`
   - 响应式简单适配
4. **GitHub Actions 部署**：push 到 `main` 且 `packages/landing/` 有变更时自动构建并部署到 GitHub Pages

### 不包含

- 下载按钮的实际链接（先占位）
- 截图素材的制作（由用户提供图片文件）
- 自定义域名配置（使用 GitHub Pages 默认域名 `mengrru.github.io/Spherse/`）
- app package 的任何改动

## 技术方案

### 方案选型：自包含 package + 复制 shadcn 组件（方案 A）

`packages/landing` 完全自包含，使用标准 Vite（非 electron-vite）构建。从 app 复制需要的 shadcn 组件源码（Button、Dialog）+ `styles.css` token 体系 + `cn()` 工具函数到 landing package 内。

选择理由：
- shadcn 的设计哲学就是 copy-based，复制组件源码是预期用法
- landing 只需 Button + Dialog 两个组件，复制成本极低
- 完全独立的构建和部署，不耦合 app package
- 标准 Vite 静态部署，无需 Electron 依赖

### i18n 方案

复用 `@spherse/i18n` 的类型定义（`Locale`、`SUPPORTED_LOCALES`、`normalizeLocale`），但自建 landing 专属 locale catalog，不污染 app 的翻译 key。

- locale 持久化：`localStorage` key `spherse-landing-locale`
- 首次访问：`normalizeLocale(navigator.language)` 探测浏览器语言
- hook：`useLandingI18n()` 返回 `{ locale, setLocale, t }`
- 语言切换器：右上角三语按钮，当前语言高亮

## 详细设计

### Package 结构

```
packages/landing/
├── package.json              # @spherse/landing, vite + react + tailwind v4
├── vite.config.ts            # 标准 Vite, base: "/Spherse/"
├── tsconfig.json
├── index.html
├── public/
│   ├── screenshots/
│   │   ├── carousel-1.png ~ carousel-4.png       # 轮播截图（不同项目的 APP 界面）
│   │   └── features/
│   │       ├── local/      # 本地运行特性截图
│   │       ├── agents/     # 多 Agent 特性截图
│   │       ├── trigger/    # 触发器特性截图
│   │       └── theme/      # 主题定制特性截图
│   └── themes/
│       ├── screenshot-1.css ~ screenshot-4.css   # 每张轮播截图对应的主题 CSS
├── src/
│   ├── main.tsx
│   ├── App.tsx               # 页面组合
│   ├── styles.css            # Tailwind v4 + --sp-* token 体系（从 app 复制精简）
│   ├── lib/
│   │   └── utils.ts          # cn() 工具（从 app 复制）
│   ├── i18n/
│   │   ├── index.ts          # useLandingI18n hook + locale 持久化
│   │   └── locales/
│   │       ├── zh-CN.ts      # landing 专属翻译（canonical）
│   │       ├── zh-TW.ts
│   │       └── en.ts
│   ├── components/
│   │   ├── ui/
│   │   │   ├── button.tsx    # 从 app 复制，调整 base 尺寸适配 web 场景
│   │   │   └── dialog.tsx    # 从 app 复制
│   │   ├── LanguageSwitcher.tsx
│   │   ├── Hero.tsx
│   │   ├── Carousel.tsx
│   │   ├── FeatureCards.tsx
│   │   ├── FeatureModal.tsx
│   │   ├── UpcomingFeatures.tsx
│   │   └── Footer.tsx
│   └── data/
│       ├── slides.ts         # 轮播配置（截图路径 + 主题 CSS 路径 + avatar 色标签）
│       └── features.ts       # feature 卡片配置（id + 图标 + i18n key + 截图列表）
```

### 依赖

```json
{
  "dependencies": {
    "@spherse/i18n": "*",
    "@base-ui/react": "^1.5.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^1.17.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^3.6.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.2.4",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.7.0",
    "tailwindcss": "^4.2.4",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

### 页面布局

从上到下：

1. **顶部栏**：右上角语言切换器（中文 / 繁體 / EN）
2. **Hero 区**：
   - `<h1>Spherse</h1>`
   - `<p>本地运行、开箱即用的AI辅助文字创作与演绎桌面工具</p>`
   - macOS 下载按钮 + Windows 下载按钮（先占位 `#`）
3. **轮播区**：4 张 APP 界面截图，详见下方轮播组件设计
4. **特性卡片**：4 张卡片网格，点击打开浮层
5. **即将到来的功能**：2 个功能卡片
6. **Footer**：`Spherse@2026`

### 轮播组件设计（Carousel）

**数据结构**（`data/slides.ts`）：

```ts
interface Slide {
  screenshot: string;      // "/screenshots/carousel-1.png"
  theme: string;           // "/themes/screenshot-1.css"
  avatarColor: string;     // "hsl(210, 50%, 65%)" — 与截图内 avatar 颜色一致
  avatarLabel: string;     // "H" — 与截图内 avatar 首字母一致
}
```

**布局**：

```
┌─────────────────────────────────────┐
│         screenshot (16:10)          │
│ ┌──┐                                │
│ │H●│  ← 锚定按钮列（叠在 avatar 上） │
│ │R │                                │
│ │F │                                │
│ │D │                                │
│ └──┘                                │
└─────────────────────────────────────┘
```

- 截图容器 `position: relative`，内部 `<img>` 填满
- 锚定按钮列 `position: absolute`，定位在截图左侧 activity bar 区域（`top` 和 `left` 精确对齐截图内 avatar 的位置）
- 每个锚定按钮：`36px × 36px`（`size-9`，`rounded-lg`），与 app 的 `ProjectAvatar` 一致
- 非 active 按钮：完全透明（`opacity-0`），但可点击
- active 按钮：透明背景 + 发光描边（`box-shadow: 0 0 8px 2px {avatarColor}`），描边颜色取自该 slide 的 `avatarColor`

**主题切换机制**：

- `Carousel` 组件内用 ref 持有当前 `<link>` 元素
- slide 切换时：移除旧 `<link>`，创建新 `<link rel="stylesheet" href={slide.theme}>` 插入 `document.head`
- theme CSS 内容是 `:root { --sp-*: ... }` 覆盖，与 app 的 project theme 机制一致
- 组件卸载时移除当前 `<link>`

**自动播放**：

- 5 秒间隔，`setInterval` 驱动
- 用户点击锚定按钮时重置计时器
- 组件不可见时（`IntersectionObserver`）暂停

**响应式**：

- 桌面：截图大尺寸，锚定按钮按原比例叠加
- 移动端：截图缩放，锚定按钮等比缩小（如 `size-7`），位置微调

### Feature 卡片与浮层

**数据结构**（`data/features.ts`）：

```ts
interface Feature {
  id: "local" | "agents" | "trigger" | "theme";
  icon: LucideIcon;          // 直接引用 lucide-react 图标组件（如 ShieldCheck）
  i18nKeyPrefix: string;     // "feature.local" — 组件内拼接 {prefix}.title / {prefix}.desc
  screenshots: string[];     // ["/screenshots/features/local/1.png", ...]
}
```

**4 张卡片**：

| id | 图标 | 标题 | 描述 |
|---|---|---|---|
| local | ShieldCheck | 本地运行 · 数据自主 | 全本地运行，数据不离开你的机器 |
| agents | Bot | 多 Agent 与 Skill 系统 | 创建多个角色，各有专属工具与技能 |
| trigger | Clock | 触发器与自动化 | 定时触发与事件触发，自动执行 |
| theme | Palette | UI 主题与功能深度定制 | 项目级与 Agent 级 CSS 主题定制 |

**卡片样式**：

- `bg-card` + `border` + `rounded-xl`，hover 时 `shadow-md` + 轻微上移（`-translate-y-0.5`）
- 点击打开浮层

**浮层交互**（复制 shadcn Dialog，调整尺寸）：

- Dialog `max-w-3xl`（比 app 默认的 `sm:max-w-sm` 大，适合展示截图）
- 浮层结构：标题（图标 + feature 名）+ 横向滚动截图列表
- 截图横向排列（`flex` + `overflow-x-auto`），每张 `flex-shrink-0`，宽度填满浮层可见区
- 无分页圆点，无左右箭头，纯横向滚动
- 关闭：点击 ✕ 按钮或点击 backdrop

**响应式**：

- 桌面：4 列网格
- 平板：2 列
- 移动端：1 列

### 即将到来的功能

| 图标 | 标题 | 描述 |
|---|---|---|
| Brain | Agent 跨 Session 记忆 | Agent 将能跨会话保持长期记忆 |
| Plug | 连接器（MCP） | 通过 MCP 协议连接外部工具与服务 |

样式：虚线边框卡片（`border-dashed`），区别于已上线特性。

### 部署方案

**GitHub Actions workflow**（`.github/workflows/deploy-landing.yml`）：

触发条件：push 到 `main` 分支且 `packages/landing/` 有变更。

```yaml
on:
  push:
    branches: [main]
    paths: ["packages/landing/**"]
```

流程：
1. checkout
2. setup Node 20
3. `npm ci`
4. `npm run build --workspace=packages/landing`（需先 build `@spherse/i18n`）
5. 用 `peaceiris/actions-gh-pages` action 将 `packages/landing/dist/` 推到 `gh-pages` 分支

**base 路径**：Vite `base` 设为 `/Spherse/`（GitHub Pages 项目页面路径，repo 名 `Spherse`）。

**根 package.json 脚本**：

- `npm run dev:landing`：启动 Vite dev server
- `npm run build:landing`：构建（含 `@spherse/i18n` 依赖构建）
- root `build` 脚本不变（landing 独立构建，不纳入 app build 链）

**lint**：landing package 纳入 root ESLint flat config 覆盖范围。

## 文档更新

### AGENTS.md 简介更新

将开头的产品描述从：

> 一个全平台、本地运行、开箱即用的 AI 辅助世界观创作桌面工具。

改为：

> 一个本地运行、开箱即用的AI辅助文字创作与演绎的桌面工具。

### README

纯中文编写，内容包括：
- 项目名称 + 一句话描述
- 产品截图（轮播截图之一）
- 核心特性列表
- 下载与安装
- 快速上手
- 技术栈
- 开发指南（构建/测试/lint 命令）
- License

写好后翻译为英文版 `README.en.md`。

### project-structure.md 更新

在 `packages/` 下新增 `landing/` 目录的索引说明。

### backlog.md 更新

新增 landing page 相关条目并标记完成状态。
