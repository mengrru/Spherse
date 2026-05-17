# Spherse

一个全平台、本地运行、开箱即用的 AI 辅助世界观创作桌面工具。基于 Electron + React + Fastify，使用 pi-agent-core 作为 agent 运行时，pi-ai 作为 LLM provider。

设计文档：`docs/official/`
待办事项：`docs/dev/backlog.md`

## 项目目录索引

```
spherse/
├── packages/
│   ├── core/        # @spherse/core — 纯 Node.js 核心逻辑
│   ├── server/      # @spherse/server — Fastify API 层
│   └── app/         # @spherse/app — Electron + React
├── docs/
│   ├── official/    # 正式项目文档（始终与代码同步）
│   └── dev/         # 开发过程文档（容易过时）
├── package.json     # npm workspace root
└── tsconfig.base.json
```

完整目录索引见 [`docs/official/project-structure.md`](docs/official/project-structure.md)。

## 启动和联调方式

```bash
# 安装依赖
npm install

# 编译所有 package
npm run build

# 监听编译（开发时使用）
npm run dev --workspace=packages/core    # core 监听
npm run dev --workspace=packages/server  # server 监听

# 启动桌面应用
npm run dev
```

**测试命令（packages/core）**：

```bash
npm test --workspace=packages/core          # 运行测试
npm run test:watch --workspace=packages/core # 监听模式
npm run test:cov --workspace=packages/core   # 运行测试并生成覆盖率报告
```

**核心层调试**：`packages/core` 和 `packages/server` 不依赖 Electron，可以直接用 Node.js 测试。

## 开发规范

- **文档规范**：
  - `docs/official/` — 正式项目文档，始终与代码保持同步
  - `docs/dev/features/{yyyy-MM-dd-feature-name}/` — **开发中的 feature spec 和 implementation plan，务必放此目录，不要放到其它位置**
  - `docs/dev/bugfix/` — bugfix 分析与修复思路
  - `docs/dev/` 下的文档容易过时，开发新 feature 时应优先参考 `docs/official/`，开发完成后根据情况更新 `docs/official/`
- **`docs/official/` 维护**：完成 feature 后，检查 `docs/official/` 下是否有需要同步更新的文档（如新增文件/目录、新增工具、架构变更等），保持文档与代码一致
- **Backlog 维护**：每完成一个 feature 后，更新 `docs/dev/backlog.md` 中对应条目的状态（`[ ]` → `[x]`），并补充新增的 backlog 条目
- **手动 commit**：完成代码后不要自动 commit，等待用户明确要求时再提交
- **commit 前检查**：用户提示 commit 后，先确认 `docs/dev/backlog.md` 和 `docs/official/` 已根据本次变更得到应有的更新，再执行 commit

## 编码规范

- **语言**：TypeScript（ESM），strict mode
- **TypeScript 配置**：target ES2022, module Node16, moduleResolution Node16
- **依赖规范**：
  - pi-agent-core 的 `AgentTool` 接口使用 `@sinclair/typebox` 定义参数 schema
- **工具模式**：所有 AgentTool 使用工厂函数模式 `createXxxTool(projectRoot: string): AgentTool`
- **路径安全**：所有文件操作工具必须做 `path.resolve + startsWith` 校验，防止路径穿越
- **不添加注释**：除非用户明确要求
- **Git 规范**：commit message 使用 `feat:` / `fix:` / `chore:` 前缀
- **前端样式**：使用 Tailwind CSS v4 工具类 + CSS 变量色彩体系，不写原生 CSS class
- **测试覆盖**：`packages/core` 的开发需保证单元测试覆盖，修改已有模块后应补充或更新对应测试
