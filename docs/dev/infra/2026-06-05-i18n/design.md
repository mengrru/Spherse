# i18n 基础设施设计

## 背景

Spherse 当前界面和运行时提示中存在大量中文硬编码字符串，且没有统一的 locale 设置、翻译资源或缺失翻译检查机制。新增 i18n 后，需要同时覆盖：

- 前端 React renderer 中的按钮、空状态、弹窗、错误提示、toast、tab 和表单文案
- Electron 主进程暴露给 renderer 的应用级设置、对话框标题、错误消息等用户可见文案
- Server/Core 层会返回给前端或 agent tool 的用户可见错误消息
- 内置 skill 和后续新增 UI 文案的翻译维护流程

本次是基础设施任务，目标是建立可持续维护的 i18n 体系，而不是一次性翻译所有历史内容。

## 需求对齐

### 本次范围

1. 支持 `zh-CN`、`zh-TW`、`en` 三种 locale。
2. 前端、Electron、server、core 都通过同一套 locale key 和翻译资源获取用户可见文案。
3. 在全局设置中新增语言设置，并持久化到 electron-store。
4. React renderer 能在运行时切换语言，无需重启应用。
5. Electron/server/core 运行时能读取当前语言，用于生成错误消息、确认消息、tool 结果等用户可见文案。
6. 新增面向 Spherse 开发者 coding agent 的本地 `i18n` skill，指导 agent 扫描代码、补齐 string key、更新 `packages/i18n` 中的三种语言资源并执行校验。
7. 增加自动校验，防止 locale 资源缺 key、key 不一致或残留明显硬编码 UI 文案。

### 非目标

- 不做用户自定义语言包。
- 不支持项目级语言设置；语言是应用级偏好，所有打开项目共享。
- 不翻译用户创作内容、agent 输出内容、项目文件内容、模型返回内容。
- 不翻译第三方 provider/model 名称、文件路径、API key env 名、技术标识符。
- 不处理 `@spherse/presets` 内置模板和预置内容的 i18n 落地；未来如需支持，作为独立 backlog 跟进。
- 不为每个 server 实例维护独立语言；server/core 使用应用当前语言即可。
- 不引入远程翻译服务或在线 TMS。

## 方案选择

### 方案 A：React 侧引入 i18next，后端保持英文/中文字符串

优点是前端切换语言成熟、实现快。缺点是 Electron/server/core 仍会继续散落硬编码字符串，无法满足“前后端都需要 i18n”，也会让错误消息和 UI 文案风格不一致。

### 方案 B：新增共享 `@spherse/i18n` workspace package

共享 package 维护 locale 类型、翻译资源、`t()` 函数、fallback 规则和校验脚本。React 使用该 package 提供的 provider/hook，Electron/server/core 使用同一个纯函数 API。优点是边界清晰、类型可复用、后端也能统一翻译，适合 monorepo。缺点是需要新增一个 package 和脚本。

### 方案 C：把翻译资源放进每个项目的 `.spherse/i18n/`

优点是允许项目自定义语言。缺点是把应用 UI 文案变成用户项目数据，会导致打开不同项目时界面文案变化，也增加同步和迁移成本。本次不需要项目级定制。

### 推荐

采用方案 B：新增 `packages/i18n`。它能同时覆盖前端和后端，不把应用文案污染到用户项目目录，也方便 `i18n` skill 和 CI 校验直接操作统一资源。

## 架构

### Package 边界

新增 workspace package：

```text
packages/i18n/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── catalog.ts
│   ├── format.ts
│   ├── react.tsx
│   └── locales/
│       ├── zh-CN.ts
│       ├── zh-TW.ts
│       └── en.ts
└── scripts/
    └── check-i18n.mjs
```

`@spherse/i18n` 是纯 TypeScript package，不依赖 Electron、Fastify 或 core。它可以依赖 React 作为 peer/dependency 只在 `react.tsx` 中使用；纯后端入口不 import React。

Root build 顺序调整为：`i18n -> core -> presets -> server -> app`。

### Locale 类型

```typescript
export const SUPPORTED_LOCALES = ["zh-CN", "zh-TW", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "zh-CN";

export type TranslationKey = keyof typeof zhCN;
```

`zh-CN` 是 canonical catalog，所有 key 以它为准。`zh-TW` 和 `en` 必须拥有完全相同的 key。key 使用 dot path 命名，例如：

- `app.loading`
- `settings.title`
- `settings.models.defaultModel`
- `content.save.error`
- `server.content.notFound`
- `core.tools.readFile.pathRequired`

### 翻译资源格式

翻译资源使用 TypeScript object，而不是 JSON：

```typescript
export const zhCN = {
  "app.loading": "加载中...",
  "settings.title": "设置",
  "settings.models.save": "保存",
  "server.content.notFound": "文件不存在",
} as const;
```

选择 TypeScript 的原因：

- 能从 canonical catalog 推导 `TranslationKey` 类型。
- 构建产物可直接被 app/core/server 引用，无需额外 runtime 文件复制。
- `i18n` skill 和校验脚本可以稳定修改明确文件。

### 翻译 API

纯函数入口：

```typescript
export function normalizeLocale(value: unknown): Locale;

export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string;

export function createTranslator(locale: Locale): {
  locale: Locale;
  t: typeof translateForLocale;
};
```

格式化只支持简单变量插值：`"无法读取文件：{path}"`。不在本轮引入复数、日期、数字格式化。缺失 key 在开发环境抛错，在生产环境 fallback 到 `zh-CN`，仍缺失时返回 key 本身。

React 入口：

```typescript
export function I18nProvider(props: {
  locale: Locale;
  children: React.ReactNode;
}): React.ReactElement;

export function useI18n(): {
  locale: Locale;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
};
```

`react.tsx` 是单独子入口，避免 core/server import React。

## 设置与数据流

### AppSettings 扩展

`packages/core/src/types.ts` 中的 `AppSettings` 增加：

```typescript
locale: Locale;
```

Electron settings 读取时兼容旧数据：如果没有 `locale`，使用 `DEFAULT_LOCALE`。保存时写入完整 settings。

### Renderer 初始化

1. `App` 启动后通过 app store 或 settings store 调用 `window.electronAPI.getSettings()`。
2. 读取 `settings.locale ?? DEFAULT_LOCALE`。
3. `App` 顶层包裹 `I18nProvider`。
4. 所有业务组件通过 `useI18n().t()` 渲染文案。

语言切换发生在 Settings modal 中：

1. 用户选择语言。
2. `saveSettings()` 写入 electron-store。
3. renderer store 更新当前 locale。
4. React 重新渲染，UI 立即切换语言。
5. Electron main 同步记录当前 locale，后续 IPC/server/core 请求使用新 locale。

### Electron、Server、Core 语言传递

Electron main 是应用语言的来源。设计为：

- `settings.ts` 暴露 `getLocale()`、`setLocale()`，基于 electron-store 和内存缓存。
- `saveSettings()` 更新 locale 后调用所有运行中 server/engine 的 locale setter。
- `server.ts` 创建项目 server 时传入 `localeProvider` 或初始 locale。
- `@spherse/server` 的 `AppContext` 增加 `getLocale: () => Locale`。
- 路由中需要返回用户可见错误时调用 `translate(ctx.getLocale(), key, params)`。
- core 的 `Engine` 增加 `setLocale(locale)` 和 `getLocale()`，tool 和 store 层需要用户可见文案时通过 engine 或 tool factory 传入 locale provider。

保持 locale provider 是函数而不是固定值，避免每次语言切换都重建所有 server 和 engine。

## 前端改造策略

### 文案迁移范围

第一阶段迁移所有 renderer 中用户可见的静态 UI 文案，包括：

- `App.tsx` 的加载文案
- Settings modal 中的标题、tab、按钮、状态、提示
- Activity bar、Project panel、Agent/session list
- Chat 输入、空状态、错误提示、tool call 展示文案
- Content browser、file tree、确认弹窗、冲突提示
- 通用 `EmptyState` 等共享组件

### 不迁移内容

- route path、query 参数、storage key
- className、ARIA id、test id
- API endpoint path
- provider/model 名称和 env key
- console debug log，除非该 log 同时显示给用户

### 组件使用方式

组件内直接使用：

```typescript
const { t } = useI18n();
return <Button>{t("settings.models.save")}</Button>;
```

不为每个 feature 建立独立 i18n store。locale 是应用级状态，由 app/settings store 管理；翻译资源由 `@spherse/i18n` 提供。

## 后端改造策略

后端只翻译会跨边界显示给用户的字符串：

- HTTP error body 的 `error` 字段
- WebSocket error event 的 `message`
- agent tool 返回给用户/模型、且会被 UI 展示的错误文案
- Electron IPC 返回给 renderer 的错误或确认消息

后端内部日志、异常 stack、开发调试输出不翻译。异常处理优先返回稳定 key 对应的文案，不把内部错误细节暴露给用户。

## `i18n` Skill 设计

这里的 `i18n` skill 是给 Spherse 开发者自己的 coding agent 使用的开发流程指导，不是 Spherse app 内给终端用户或项目 agent 使用的 `.spherse/skills`。它的职责是帮助开发者在修改代码时把用户可见字符串迁移到 `packages/i18n`，并维护 `zh-CN`、`zh-TW`、`en` 三份 locale 资源。

### 位置

新增仓库内维护的 coding-agent skill：

```text
.opencode/skills/i18n/SKILL.md
```

该 skill 不经过 Spherse app 的 `SkillStore`、`load_skill` tool 或 `.spherse/skills`。它只服务本仓库开发工作流，类似现有 opencode skill，用于约束 coding agent 如何替换字符串、生成 key、更新 locale 文件和运行校验。

### 触发方式

开发者在本仓库中对 coding agent 说“使用 i18n skill 更新 string”或类似指令。coding agent 加载 `.opencode/skills/i18n/SKILL.md` 后，使用本地文件编辑能力修改应用代码和 `packages/i18n` 资源。

### Skill 指令内容

`i18n` skill 应要求 agent：

1. 扫描用户指定范围内的 TS/TSX 文件。
2. 区分用户可见文案和不应翻译的技术字符串。
3. 为新增文案生成稳定、语义化 key。
4. 更新 `packages/i18n/src/locales/zh-CN.ts`、`zh-TW.ts`、`en.ts`。
5. 将代码中的硬编码文案替换为 `t(key)` 或后端 `translate(locale, key)`。
6. 对有变量的字符串使用 `{name}` 插值，不拼接翻译字符串。
7. 运行 `npm run check:i18n` 和受影响 package 的测试/构建。
8. 在回复中列出新增/修改的 key 和未处理原因。

### 更好的补充方案

仅靠 skill 容易遗漏或误判字符串，因此需要配套校验脚本。推荐组合：

- `i18n` skill 负责半自动迁移和翻译建议。
- `check-i18n` 脚本负责确定性检查：key 完整性、空值、重复 key、明显硬编码中文 UI 文案。
- code review 负责判断文案是否应该翻译、翻译质量是否合格。

## 校验与测试

### `check-i18n` 脚本

新增 root script：

```json
"check:i18n": "npm run check -w @spherse/i18n"
```

`packages/i18n/scripts/check-i18n.mjs` 检查：

1. 三个 locale 文件 key 集合完全一致。
2. 每个值是非空字符串。
3. 插值变量集合一致，例如中文有 `{path}`，英文也必须有 `{path}`。
4. 扫描 `packages/app/src`、`packages/app/electron`、`packages/server/src`、`packages/core/src` 中明显的中文字符串字面量，并允许白名单排除测试数据、Markdown 示例、provider 名称等。

### 单元测试

`packages/i18n` 覆盖：

- `normalizeLocale()` 对未知值 fallback 到 `zh-CN`。
- `translate()` 正常返回、插值、缺 key fallback。
- React provider/hook 基本渲染。
- `check-i18n` 的 key/变量一致性逻辑。

### App 测试

更新已有 app store/settings 测试：

- 旧 settings 无 locale 时 fallback。
- 保存 settings 时保留 provider/defaultModel，同时写入 locale。
- 切换语言后 Settings modal 中至少一个关键文案变化。

## 实施步骤

1. 新增 `packages/i18n` package、locale 类型、翻译 API、React provider 和校验脚本。
2. 更新 root workspace/build scripts，让 `@spherse/i18n` 先于依赖方构建。
3. 扩展 `AppSettings`、Electron settings、preload 类型和 settings store，加入 `locale`。
4. 在 `App` 顶层接入 `I18nProvider`，Settings modal 增加语言选择。
5. 迁移 renderer 用户可见静态文案。
6. 给 server/core/electron 用户可见错误消息接入 `translate()`。
7. 新增 `.opencode/skills/i18n/SKILL.md`，明确它是开发者 coding-agent skill，不是 app 内项目 skill。
8. 更新 `docs/official/architecture.md`、`docs/official/data-conventions.md` 和 `docs/dev/backlog.md`。
9. 运行 `npm run build`、`npm test --workspace=packages/core`、`npm test --workspace=packages/app`、`npm run check:i18n`。

## 风险与取舍

- **迁移量大**：UI 文案分散，建议先建立基础设施和检查脚本，再按 feature 分批迁移。
- **繁体翻译质量**：`zh-TW` 不应只做机械字符转换，关键术语需要统一。初版可用人工校对后的简繁转换作为基础。
- **后端 locale 时效**：如果 server/core 使用固定 locale，切换语言后旧错误消息仍是旧语言。使用 locale provider 函数规避。
- **类型导入循环**：core 当前定义 `AppSettings`，新增 `Locale` 后 core 会依赖 i18n。需要保证 i18n 不反向依赖 core。
- **skill 自动迁移误判**：skill 不能替代校验和 review，尤其是技术字符串、测试样例和用户内容。

## 成功标准

- 应用设置中可以选择简体中文、繁体中文、英文，并持久化。
- renderer 切换语言后无需重启即可更新已迁移 UI 文案。
- server/core/electron 的用户可见错误消息通过共享 i18n catalog 输出。
- `i18n` skill 可在本地加载并指导 agent 更新 string key 和三种语言资源。
- `npm run check:i18n` 能发现 locale key 不一致、插值变量不一致和明显硬编码中文 UI 文案。
- 官方架构/数据文档和 backlog 在实现完成时同步更新。
