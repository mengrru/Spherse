# 修复计划：项目打开失败覆盖项目文件

## 变更清单

| # | 文件 | 变更 |
|---|---|---|
| 1 | `packages/core/src/errors.ts` | 新增 `ProjectConfigNotFoundError`、`ProjectConfigParseError` |
| 2 | `packages/core/src/store/project-config.ts` | `read()`：文件缺失抛 NotFound；YAML parse 异常 / 空文件 / 非对象（含数组）抛 ParseError |
| 3 | `packages/core/src/factory.ts` | catch 只放行 `ProjectConfigNotFoundError` 走 `create()`，其余上抛 |
| 4 | `packages/core/src/store/project.ts` | `create()` 写 `AGENTS.md` / `CHANGELOG.md` 改用 `wx` flag（`writeFileIfMissing`），已存在则保留 |
| 5 | `packages/desktop/electron/ipc/project.ts` | restore-projects 静默 catch 改为 `console.error` |
| 6 | `packages/desktop/electron/server.ts` | ensureServer 重新注册的静默 catch 改为 `console.error` |
| 7 | `packages/app/src/features/activity-bar/use-project-actions.ts` | `handleAddProject` 补 try/catch + toast |
| 8 | `packages/i18n/src/locales/{zh-CN,zh-TW,en}.ts` | 新增 `activity-bar.openProjectFailed` |

## 测试

- 新增 `packages/core/src/__tests__/factory.test.ts`：
  - 全新目录初始化成功（默认文件齐全）
  - 损坏 yaml → rejects，`project.yaml` / `AGENTS.md` / `CHANGELOG.md` 内容原样保留
  - 空 yaml → rejects，文件不被重写，`AGENTS.md` 不被创建
  - 已有 `AGENTS.md` / `CHANGELOG.md` 的目录新建项目 → 用户内容保留
- `packages/core/src/__tests__/store/project.test.ts` 增补：NotFound 错误类型断言、create 保留已有根文件
- `packages/core/src/__tests__/store/project-config.test.ts` 增补：NotFound / 损坏 YAML / 空文件 / YAML 数组四类错误类型断言

## 验证

```bash
npm test --workspace=packages/core      # 1103+ tests
npm test --workspace=packages/server    # registry / contract 不回归
npm test --workspace=packages/app       # activity-bar 相关
npm run check:i18n                      # 三语言 key 一致
npm run lint                            # 0 error
npm run build --workspace=packages/core # tsc 通过
```

## 不做的事

- 不改 `registry.ts` 的 `regenerateProjectId`（仅 open 成功后触发，且保留全量配置，无覆盖风险）
- 不处理 symlink 双开同一目录的 id 竞争（独立问题，留 backlog）
- 不为损坏项目提供 UI 内修复入口（后续 backlog：损坏项目会一直留在 openProjects 设置中，每次启动重试并记日志）
