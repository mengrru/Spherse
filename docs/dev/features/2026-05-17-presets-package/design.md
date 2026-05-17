# @spherse/presets — 预置静态内容包

## 目标

创建 `@spherse/presets` package，集中管理预置的静态内容（agent 模板、preset skill 等），供其他 package 引用。

## 动机

当前 agent 创建模板硬编码在 `packages/app/src/components/AgentDialog.tsx` 中。未来还有预置 skill 等静态内容需要管理。将这些内容集中到一个独立 package 中，便于维护和复用。

## 设计

### 内容存储与导出策略

- 可编辑源文件以 `.md` 存储在 `templates/` 目录
- `prebuild` 脚本扫描 `templates/`，将每个 `.md` 文件内容生成为 `src/generated/` 下的 `.ts` 常量导出
- 消费者同步导入常量，无需异步加载
- 对于 skill 等需要整个目录复制的场景，导出 `getTemplatesDir()` 提供路径

### 目录结构

```
packages/presets/
├── package.json
├── tsconfig.json
├── scripts/
│   └── sync-templates.ts        # 读取 templates/*.md 生成 src/generated/*.ts
├── templates/
│   └── agent-template.md        # 可编辑的模板源文件
└── src/
    ├── index.ts                 # 统一导出（re-export generated + resolve）
    ├── resolve.ts               # getTemplatesDir() 路径解析
    └── generated/               # 由 sync-templates 自动生成，git 忽略
        └── agent-template.ts    # export const AGENT_TEMPLATE = `...`
```

### API

- `AGENT_TEMPLATE: string` — agent 创建模板内容（同步常量）
- `getTemplatesDir(): string` — 返回 templates/ 根路径（用于 skill 目录复制等场景）

### sync-templates 脚本

读取 `templates/` 下每个 `.md` 文件，生成对应的 `src/generated/<name>.ts`：

```
templates/agent-template.md → src/generated/agent-template.ts
                                export const AGENT_TEMPLATE = `<内容>`;
```

作为 `prebuild` 步骤运行。`src/generated/` 加入 `.gitignore`。

### 路径解析

`resolve.ts` 使用 `import.meta.url` + `fileURLToPath` 定位 `dist/`，`path.join(__dirname, "../templates/")` 指向 templates 目录。仅 `getTemplatesDir()` 使用，常量导出不依赖文件系统。

### 构建配置

- 继承 `tsconfig.base.json`，使用 `tsc` 构建
- `package.json` scripts: `"prebuild": "tsx scripts/sync-templates.ts", "build": "tsc"`
- `files` 字段包含 `["dist", "templates"]`
- 运行时依赖：无（常量导出场景）；`getTemplatesDir()` 仅限 Node.js 环境
- 开发依赖：`tsx`（用于运行 sync-templates 脚本）

### 消费者变更

`packages/app/src/components/AgentDialog.tsx`:
- 删除内联 `AGENT_TEMPLATE` 常量
- 改为 `import { AGENT_TEMPLATE } from "@spherse/presets"`（同步导入，无异步）

## 修改范围

- 新增: `packages/presets/` 整个 package
- 修改: `packages/app/package.json` — 添加 `@spherse/presets` 依赖
- 修改: `packages/app/src/components/AgentDialog.tsx` — 从 presets 导入常量
- 更新: `docs/official/project-structure.md` — 添加 presets package 描述

## 未来扩展

- 预置 skill：在 `templates/skills/` 下添加 skill 目录，通过 `getTemplatesDir()` 定位后复制到用户项目
- 更多 agent 模板：在 `templates/` 下添加不同类型的 `.md` 模板文件
