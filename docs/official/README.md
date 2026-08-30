# Official Docs

`docs/official/` 是与代码始终同步的正式文档。本文是索引与写作规范；`docs/dev/` 是历史过程记录，两者边界见根目录 `AGENTS.md` 文档地图。

## 按任务路由

| 我要… | 读 |
|---|---|
| 了解全局 / package 边界 / 组合根 | [`architecture/index.md`](architecture/index.md) |
| 改 core 内核、会话运行时、store、PM 门面 | [`architecture/core.md`](architecture/core.md) |
| 新增或修改 capability / 工具 / skill / trigger / MCP | [`architecture/capabilities.md`](architecture/capabilities.md) |
| 改权限、访问策略、审批、run_command | [`architecture/security.md`](architecture/security.md) |
| 改 HTTP API、contract、WebSocket、bus | [`architecture/server.md`](architecture/server.md) |
| 改 Electron 主进程、设置、模型配置、更新 | [`architecture/desktop.md`](architecture/desktop.md) |
| 改前端路由、查询缓存、feature 组织 | [`architecture/frontend.md`](architecture/frontend.md) |
| 改聊天流式、重试、历史、滚动 | [`architecture/chat.md`](architecture/chat.md) |
| 改 UI SDK / `@spherse/sdk` | [`architecture/ui-sdk.md`](architecture/ui-sdk.md) |
| 改主题、token、可主题化 DOM 入口 | [`architecture/theming.md`](architecture/theming.md) |
| 改 i18n | [`architecture/i18n.md`](architecture/i18n.md) |
| 改数据文件格式与存储位置 | [`data-conventions.md`](data-conventions.md) |
| 写测试 / 选测试层 / 改测试基建 | [`testing.md`](testing.md) |
| 对齐术语 / 查一个词指什么 | [`glossary.md`](glossary.md) |
| 找文件 / 目录在哪 | [`project-structure.md`](project-structure.md) |

包内编码/review 规范在各 package 的 README，不放这里。

## 写作规范

所有 `docs/official/` 下的文档遵守：

- **只写现状**：历史沿革（「取代了旧方案」「已删除」）进 `docs/dev/`，official 不做 changelog
- **只写结论**：论证（动机、取舍、反例）进 ADR（`docs/dev/decisions/`）或 design doc，正文至多留一个 ADR 链接
- **一条 bullet 一个事实**：单行不超过 ~200 字符；超限是用 H3 子节展开的信号，不是继续加括号的信号
- **括号嵌套最多一层**：机制细节用子列表展开，不塞进括号
- **契约与机制分离**：每个主题先写「契约」（必须遵守的规则），后写「机制」（如何运作），不混排在同一条 bullet
- **文件头**：每个文件以引用块（`>`）写 3–5 行覆盖范围与相关文件链接
- **单文件 ≤ ~200 行**：超限是该拆分的信号
- **中文行文**：文件名、代码符号、路径保持原文反引号引用

## 变更同步

什么变更需要更新哪个文件，见根目录 `AGENTS.md` 文档地图「写」表；commit 前用 **doc-sync** skill 逐项检查。
