# ADR-0005：路径访问权限集中为 category 白名单

- 状态：accepted
- 日期：2026-06-22
- 影响：`packages/core/src/access/`、全部 LLM 工具与 server 通用路由

## 背景

权限定义曾分散在多处（`isProjectMetaPath`、各 tool 内联 skip 等），且只有读侧策略——AI 可经 `write_file` 覆写 `project.yaml`、`sessions.db`、`AGENTS.md`，server `PUT /content` 漏检 `.spherse`。

## 决策

- `categorizePath` 把项目内路径分类为语义 category（`PATH_PATTERNS` 固定，不可配置）
- `llmAccessPolicy` 与 `serverAccessPolicy` 两套白名单集中裁决读写，工具与路由一律复用
- capability 私有路径经 `pathRules` 声明、优先于内置类别

## 后果

- 正：单点审计；读写两侧、AI 与 server 两个来源统一裁决
- 负：新增路径类型必须动 core 常量；spherseOther 兜底可读等历史语义需要专项决策收敛（见 backlog「安全语义对齐」）

## 原始记录

- `docs/dev/infra/2026-06-22-path-access-policy/`
