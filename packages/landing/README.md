# @spherse/landing

GitHub Pages 项目介绍页（自定义域名 spherse.mengru.work）。Vite + React SPA，Tailwind v4 + `--sp-*` token 体系。

## 文案分层

| 内容 | 位置 | 说明 |
|---|---|---|
| UI chrome（按钮、标签、页面标题等短文案） | `src/i18n/locales/`（zh-CN / zh-TW / en，zh-CN 为规范目录） | 走 landing 自建 catalog，与 `@spherse/i18n` 的区别见 `docs/official/project-structure.md` |
| 长文内容（教程、指南等成篇文档） | `src/content/docs/<id>.<locale>.md` | **禁止写成 i18n key**。每篇文章三个 locale 文件，以 `# 标题` 开头，由 `src/lib/docs.ts` 经 `import.meta.glob` 加载、`DocMarkdown` 组件（react-markdown）渲染 |

理由：catalog 适合短而有标签的 UI 文案；成篇内容写成 key 会让 catalog 膨胀且无法按 md 工作流维护。两者边界以此为准。

### 新增一篇文档

1. 在 `src/content/docs/` 新建 `.zh-CN`、`.zh-TW`、`.en` 三个 md 文件（id 保持一致，即文章 URL `/docs/<id>`）
2. 文件以 `# 标题` 开头（用作文章标题），标题后的首段会作为列表页摘要
3. 无需改代码：`/docs` 列表与 `/docs/<id>` 文章页由 `DocsPage` / `DocsArticlePage` 自动收录

约束由 `src/lib/docs.test.ts` 保证：三语齐全、以 `# ` 开头、摘要可提取、已发布 URL 的 id 不失效；locale 缺失时 `docs.ts` 的 `getDoc` 回退到默认 locale（该回退分支在测试中被三语齐全约束排除，不单独覆盖）。
