# Landing page 恢复「积木筐」品牌句 设计文档

## 概述

把「Spherse 是你的积木筐，用它来打造完全属于你自己的世界吧！」这句话加回 landing page。该句原本是首页功能卡片区的收尾文案（key：`feature.slogan`），在 `52807ec`（2026-08-03，"refine agent runtime positioning"）的产品定位打磨中被改写为新定位句，由此消失。本次以 git 历史中的原文为准，将其恢复上页。

### 原文考古结论

用户需求中记为「积木箱」，git 历史中原文实为「积木筐」。原文出自 `14cb9d9`（2026-07-13，landing page 初版），三语 verbatim 如下：

| locale | 原文 |
| --- | --- |
| zh-CN | `Spherse 是你的积木筐，用它来打造完全属于你自己的世界吧！` |
| en | `Spherse is your box of building blocks — use it to build a world entirely your own!` |
| zh-TW | `Spherse 是你的積木筐，用它來打造完全屬於你自己的世界吧！` |

该句从未出现在 README 或 docs 中，只存在于 landing 的 i18n catalog。用户明确要求「在 history commit 中找到原文」，因此按「积木筐」原文恢复，不改字。

### 现状

`feature.slogan` 这个文案槽位和渲染点至今仍在（`packages/landing/src/components/FeatureCards.tsx:43`，功能区六张卡片之后的居中收尾行），但内容已被 `52807ec` 改写为：

> 你创造和分享的不只是一段 Prompt，而是一个可以直接运行的 Agent Workspace。

## 范围

### 包含

1. `packages/landing/src/i18n/locales/{zh-CN,en,zh-TW}.ts` 三语新增 `feature.motto` key，取上表原文
2. `packages/landing/src/components/FeatureCards.tsx` 功能区收尾处由单行 `<p>` 扩为两行

### 不包含

- 现有 `feature.slogan`（新定位句）的任何改动——保留 `52807ec` 的定位成果
- Hero 区文案、Footer、其它任何 landing 区块
- README / docs / app package 改动

## 方案对比

### 方案 A：原位替换——把 `feature.slogan` 的值改回原文

改动最小（三语各 1 行），页面完全复原到 2026-07-13 的样子。但会丢弃 `52807ec` 中有意写入的定位句，等于回滚那次产品定位决策的一半，且该句（「不只是一段 Prompt，而是可运行的 Workspace」）是当前 Agent Runtime 定位下唯一的差异化收尾表述，不应静默丢失。不推荐。

### 方案 B：两句并存——保留定位句，新增 `feature.motto` 作为情感收尾（推荐）

现有 `feature.slogan`（定位句）保持第一行不变，新增 `feature.motto`（积木筐句）作为第二行、且视觉上略加强调（foreground 色 + 稍大字号），形成「理性定位 → 情感邀请」的收尾节奏。

- 满足「加回」的字面意图：原句 verbatim 重新上页
- 不回滚 `52807ec` 的定位成果
- 该句在初版设计中本就是功能区的 closing line，恢复到原位置（紧随卡片与定位句之后）最不意外
- 代价仅一个新 key + 约 5 行 JSX

### 方案 C：改写合并为一句

保持单行收尾，但改写必然偏离「原文」要求，引入新的文案决策，违背「在 history commit 中找到原文」的意图。不推荐。

## 详细设计（方案 B）

### i18n：新增 `feature.motto`

zh-CN（翻译基准，注释按 i18n 规范说明出现位置与上下文）：

```ts
// 首页功能卡片区最末的品牌邀请句，紧接 feature.slogan 定位句下方，用「积木筐」比喻邀请用户动手搭建属于自己的世界。
"feature.motto": "Spherse 是你的积木筐，用它来打造完全属于你自己的世界吧！",
```

en、zh-TW 取考古表中 verbatim 原文，插在各自 `feature.slogan` 之后、`feature.moreCases` 之前。

类型安全兜底：`TranslationKey = keyof typeof zhCN` 且 `catalogs: Record<Locale, Record<TranslationKey, string>>`，任一 locale 缺 key 会直接编译失败，无需额外测试防护。

### 组件：FeatureCards 收尾两行

将现有：

```tsx
<p className="mx-auto mt-12 max-w-3xl text-center text-base text-muted-foreground md:text-lg">
  {t("feature.slogan")}
</p>
```

改为：

```tsx
<div className="mx-auto mt-12 max-w-3xl text-center">
  <p className="text-base text-muted-foreground md:text-lg">
    {t("feature.slogan")}
  </p>
  <p className="mt-3 text-lg font-medium text-foreground md:text-xl">
    {t("feature.motto")}
  </p>
</div>
```

定位句维持 muted 弱化样式作为铺垫，motto 用 `text-foreground` + `font-medium` + 更大字号承担情感收尾。颜色均为语义 token，暗色模式自动适配。

### 验证

1. `npm run lint`
2. `npm run build:landing`
3. `npm run dev:landing` 目测三语：功能区末尾出现两行收尾（定位句 + 积木筐句），切换 zh-CN / zh-TW / en 文案正确

landing package 无测试脚本，不新增测试；改动不涉及架构，`docs/official/` 无需同步。实现完成后在 `docs/dev/backlog.md` 补一条已完成的条目。
