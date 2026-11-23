# Plan：`npx spherse server` CLI

按 stacked PR 拆分（base：origin/dev → PR1 → PR2 → PR3 → PR4），每个 PR 独立可 review、`npm run lint` + 相关 workspace 测试通过。npm publish 不在本任务范围（用户/CI 执行）。

## PR 1：调研 + design 文档（本 PR）

- [x] `docs/dev/investigation/2026-10-12-npx-web-bootstrap/README.md`
- [x] `docs/dev/features/2026-10-12-npx-server-cli/design.md`（含 review 修订：sdk/source alias、lockfile、node 守卫、扫描边界等）
- [x] `plan.md`（本文件）

## PR 2：`packages/cli` 骨架与纯逻辑模块

- [ ] `packages/cli/package.json`：name `spherse`、`"type": "module"`、`private: true`（发版时 CI 处理）、engines、scripts（typecheck / test / lint；无 build——bundle 在 PR 4）
- [ ] `packages/cli/tsconfig.json`：对齐 server（extends base、module Node16 语义来自 base）
- [ ] 根 `package.json` workspaces 增加成员（排在 `packages/server` 之后）
- [ ] `src/args.ts`：子命令 + `--port` / `--home` / `--frontend-url` 解析（无第三方依赖）
- [ ] `src/home.ts`：`--home` > `SPHERSE_HOME` > `~/.spherse` 解析与初始化（mkdir -p projects）
- [ ] `src/settings-store.ts`：serverToken 惰性生成（randomBytes 32 hex）+ tmp+rename 原子写
- [ ] `src/lockfile.ts`：`server.lock`（pid/port/startedAt）——存活探测 `process.kill(pid, 0)`、stale 覆盖、清理
- [ ] `src/projects.ts`：扫描（withFileTypes、isDirectory、dotfile 跳过、字母序）、首启默认项目 `default` 幂等创建、`new` 落盘与校验（路径分隔符 / dot 开头 / 大小写折叠重名）；`isPathInside` 断言（`@spherse/core`）
- [ ] `src/echo.ts`：endpoint / token / 深链 URL 生成（`URLSearchParams` 编码，钉住 `buildConnectUrl` 格式）
- [ ] `src/main.ts`：分发骨架——node 版本守卫（< 22.19 报错退出）、`--version` / `--help` / `new`；`server` 分支 PR 3 实现（当前落 unknown command）
- [ ] vitest 单测：args / home / settings-store / lockfile / projects / echo / node 守卫

## PR 3：`server` 子命令（装配）

- [ ] `src/server-cmd.ts`：lockfile 接线（启动前检测 / 成功后写入 / 退出清理）→ token → 显式 `--port` 预探测（net 试绑，占用即退出）→ `createMultiProjectServer({ auth, modelSettingsPath, appVersion, port })` → 扫描注册（失败跳过不阻断）→ 实际端口读取与显式端口 TOCTOU 校验 → 回显 → SIGINT/SIGTERM → `server.close()` → 删 lockfile
- [ ] `main.ts` 接 `server` 子命令
- [ ] package.json devDependencies / workspace 依赖：`@spherse/core`、`@spherse/server`（`"*"`，workspace 解析）
- [ ] 装配测试（不 mock `createMultiProjectServer`）：tmp home + 两个项目目录 → 启动函数 → `/health`、`/api/connection/info`（authRequired、appVersion）、`/api/projects` 两项、回显端口与 address() 一致；显式端口被占退出非零；lockfile 拒绝双实例

## PR 4：bundle 发布形态 + 冒烟 + 文档同步

- [ ] `build.mjs`：esbuild（`packages: "external"`、format esm、platform node、target node22）+ workspace alias 全表（含 `@spherse/sdk/source` → `dist/source.js`）；产物不变量（不允许残留 `@spherse/*` import）；dependencies 一致性校验（从 core/server package.json 派生期望清单 diff）
- [ ] `bin/spherse.js` 薄 shim；package.json 补 `bin` / `files` / 发布用 `dependencies`（external npm 包全集，pi 系精确版本）/ `build` script
- [ ] `scripts/smoke.mjs`：bundle 后 `--version` + `--port 0` 真实实例 curl `/health`、`/api/connection/info`、preview 路径（覆盖 sdk/source subpath）
- [ ] doc-sync：`docs/official/project-structure.md`、`docs/official/data-conventions.md`（应用级数据表 CLI 行）、`docs/official/testing.md`（归属表）、根 `AGENTS.md` Package 表、`packages/cli/README.md`、backlog
- [ ] code-review skill 派 sub agent 审查全部实现；`npm run verify` 收尾
