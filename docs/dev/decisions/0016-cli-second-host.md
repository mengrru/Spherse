# ADR-0016：CLI 作为第二宿主（`npx spherse server`）

- 状态：accepted
- 日期：2026-10-12
- 影响：`packages/cli`（新包）、根 `package.json`（workspaces）、`eslint.config.js`

## 背景

server 只能在 Electron desktop 宿主内运行：token 持久化、modelSettingsPath、项目注册重放全部寄生在 desktop 主进程；registry 无持久化、无注册 API，独立启动的 server 项目列表恒为空。移动端用户（Termux 自部署）无法脱离 Electron 使用。

## 决策

- **CLI = 新 host**：`packages/cli`（npm 包名 `spherse`，bin `spherse`）复刻 desktop host 的最小职责集——serverToken 惰性生成、modelSettingsPath 注入、项目注册重放、appVersion 注入；不引入 Electron 依赖
- **项目模型用目录扫描**：`<home>/projects/` 下每个非 dotfile 子目录即一个项目，启动时扫描注册、磁盘即注册清单（相对 desktop「任意目录 + openProjects 记账」的简化，合法因为 CLI 项目位置固定）；不给 registry 加持久化、不加注册 HTTP API，server 包零改动
- **home 布局**：`~/.spherse/`（`--home` / `SPHERSE_HOME` 覆盖），与 desktop userData 天然隔离
- **发布形态**：单包 esbuild bundle——workspace 五包（server/core/contracts/sdk+source/presets）经 alias 打进产物，npm 依赖全部 external；构建不变量：产物不得残留 `@spherse/*` import、dependencies 必须与 core/server 派生清单一致
- **前端不自托管（一期）**：回显线上 PWA（GitHub Pages）登录深链（复用 `buildConnectUrl` 格式与连接页自动登录）；版本守卫要求 npm 包与线上前端同版本发布

## 后果

- 正：server 获得纯 Node 宿主；server 包边界不变（无 host 状态泄漏）；desktop 不受影响
- 负：CLI 与 desktop 两套 host 职责并行（token/settings 逻辑复制而非提炼，成本可接受）；`new` 不热注册需重启；首访依赖线上前端（离线化待 `staticDir` 二期）
- 设计详情：`docs/dev/features/2026-10-12-npx-server-cli/design.md`（调研：`docs/dev/investigation/2026-10-12-npx-web-bootstrap/`）
