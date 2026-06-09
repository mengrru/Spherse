# [Bugfix] build 失败：@spherse/core 构建时找不到 @spherse/presets

## 问题描述

执行 `npm run build` 时 `@spherse/core` 编译失败：

```
src/presets.ts(3,69): error TS2307: Cannot find module '@spherse/presets' or its corresponding type declarations.
```

## 根因分析

**引入提交**: `f96f42f feat: auto-inject preset skills and agents on project creation`

该提交在 `@spherse/core` 中新增了 `presets.ts`，导入了 `@spherse/presets` 的 `PRESET_SKILL_SOURCES`、`PRESET_AGENTS`、`AGENT_TEMPLATE`。但根 `package.json` 的 build script 构建顺序为：

```
i18n → core → presets → server → app
```

`@spherse/core` 在 `@spherse/presets` **之前**构建，此时 `@spherse/presets` 的 `dist/` 目录尚不存在，TypeScript 编译器找不到模块声明。

**依赖关系**：

```
@spherse/i18n    — 无内部依赖
@spherse/presets — 无内部依赖
@spherse/core    — 依赖 i18n + presets
@spherse/server  — 依赖 core（传递依赖 i18n + presets）
@spherse/app     — 依赖 core + presets + server
```

## 修复方案

将根 `package.json` 的 build script 中 `@spherse/presets` 的构建顺序移到 `@spherse/core` 之前：

```
i18n → presets → core → server → app
```

只需修改 `package.json` 中一行构建命令。

## 影响范围

- `package.json` — build script 构建顺序调整
- 不影响任何运行时行为
- 不影响 `npm run dev` 的 watch 模式（各 package 独立 watch）

## 验证方式

1. `npm run build` 成功通过
2. `npm run verify` 成功通过（lint + build + test）
