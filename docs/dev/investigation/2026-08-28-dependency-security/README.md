# 依赖漏洞治理与自动修复 PR 调研

调研时间：2026-08-28

## 结论

当前依赖漏洞可以通过一次受控升级清零，不需要改业务代码。建议分两步实施：

1. 先提交基线修复 PR：刷新锁文件中的兼容版本，并显式升级 `adm-zip` 到 `0.6.0`、`electron` 到 `41.10.7`。
2. 再提交自动化 PR：用 Renovate 向 `dev` 提依赖更新/漏洞修复 PR，用 Dependency Review 在 PR 上阻止新增 high/critical 漏洞，并启用 Dependabot alerts 作为 GitHub 告警面板。

不建议自建一个定时执行 `npm audit fix` 后直接提 PR 的 workflow。成熟机器人能处理并发、重开、rebase、分组、变更日志、版本约束和重复 PR；自建 workflow 很容易变成另一个需要维护的包管理器。

`main` 是稳定发布分支，`dev` 是日常集成分支。`main` 应继续作为 GitHub default branch：Dependabot alerts 保护已发布基线；Renovate、PR 差分门禁和显式全树扫描保护 `dev`。安全工具必须覆盖两条分支，不能仅为迁就 Dependabot 把 default branch 改为 `dev`。

## 仓库现状

- npm workspaces monorepo，共用根 `package-lock.json`。
- GitHub 仓库公开，default branch 是 `main`；最近 30 个 PR 全部以 `dev` 为 base。
- 调研时 `origin/main` 和 `origin/dev` 指向相同提交，但不能据此假设它们以后始终同步。
- 仓库已有 PR verify、发布和 Pages workflow，但没有依赖安全 workflow、`dependabot.yml` 或 Renovate 配置。
- 现有 `pr-build.yml` 在非纯文档 PR 上执行 `npm ci` 和 `npm run verify`，可直接验证机器人提交的依赖升级。
- Dependabot alerts、Dependabot security updates、secret scanning 均未启用。
- Actions 默认 token 权限为 read，不能批准 PR；仓库没有 ruleset，但 `dev` 已有 branch protection，要求 `verify` check 并对管理员生效。
- 本机审计工具版本：Node `24.15.0`、npm `11.12.1`。
- 修复前，三个 workflow 的项目 toolchain 和 `checkout/setup-node` action runtime 均为 Node 20；这是 Electron 安全升级必须同步处理的兼容约束。

`npm audit --json` 基线：

| Severity | 数量 |
|---|---:|
| critical | 1 |
| high | 15 |
| moderate | 2 |
| low | 1 |
| total | 19 |

这里的 `19` 是 npm 聚合出的 vulnerable package records，不等于 19 个互不相关的可利用漏洞。完整树包含运行时、打包链、测试链和可选依赖；`npm audit --omit=dev` 仍报告 10 项（8 high、2 moderate）。Electron 应用的 devDependencies 会在构建和打包阶段执行，不能把它们统一视为无风险。

## 当前漏洞与修复路径

### 可由兼容锁文件升级修复

一次非强制 `npm audit fix --package-lock-only` 可以在现有 manifest 范围内升级以下主要依赖：

- 直接依赖：`js-yaml 4.3.0 -> 4.3.2`、`nanoid 3.3.12 -> 3.3.18`、`react-router 7.16.0 -> 7.18.2`、`vite 6.4.2 -> 6.4.3`。
- 传递依赖：`tar 7.5.16 -> 7.5.22`、`undici 7.25.0 -> 7.29.0`、`ws 8.20.0 -> 8.21.3`、`find-my-way 9.5.0 -> 9.9.0`、`fast-uri 3.1.0 -> 3.1.6`、`postcss 8.5.13 -> 8.5.26` 等。

非强制修复后预计只剩三个聚合项，根因是两个 manifest 约束：

| 依赖 | 当前 | 安全版本 | 原因 |
|---|---:|---:|---|
| `adm-zip` | `0.5.17` | `0.6.0` | `0.x` caret 不跨 minor，npm 视为 breaking change |
| `electron` | `41.7.1` | `41.10.7` | manifest 精确锁定，普通 audit fix 不改声明 |
| `extract-zip` | Electron 传递依赖 | 随 Electron 修复 | npm 给出的修复入口是升级 Electron |

### 风险优先级

1. `adm-zip` 应优先处理。`SkillStore.installSkill()` 会解析并解压外部 ZIP，和公告中的 crafted archive OOM 场景直接相交。`0.6.0` 修复内存分配问题，并有两个需要关注的行为变化；现有代码使用 `extractAllTo()`，不依赖公告中改变语义的 `extractEntryTo()`。
2. Electron 应升级到同一 major 的安全 patch `41.10.7`。它修复 Electron 本体及 `extract-zip` 链路，仍保持项目现有的 major 版本策略；该版本的安装链要求 Node `>=22.12.0`，现有 `@earendil-works/pi-agent-core/pi-ai 0.84.2` 进一步要求 Node `>=22.19.0`，所以必须同时把 PR、release 和 Pages workflow 从 Node 20 升到至少 Node 22.19，并按新 CI 版本验证安装和打包。只改 Electron 会让现有 CI 运行在上游明确不支持的 Node 版本上。
3. `react-router`、`js-yaml`、Fastify 相关传递依赖均被实际代码路径使用，不能仅以“部分 advisory 涉及 SSR/RSC/HTTP2，而当前配置可能不可达”为由长期搁置。兼容升级成本低，优先升级比维护例外更合理。
4. `tar` critical 来自构建/原生依赖链，不是应用直接处理 tar 的运行时入口，但供应链和打包机仍会执行这些工具，应通过锁文件更新消除。

### 验证结果

在临时 detached worktree 中执行了受控验证，没有修改本调研 worktree：

1. `npm audit fix --package-lock-only`
2. `electron 41.7.1 -> 41.10.7`
3. core/server 的 `adm-zip -> 0.6.0`
4. `npm audit --json`

结果为 0 vulnerabilities。变更范围是三个 package manifest 和根 lockfile；lockfile 约 388 行 diff。

随后在干净安装树运行 `npm run verify`：

- lint 通过（保留仓库已有的 16 个 warning）。
- 所有 workspace build 通过。
- 所有 workspace typecheck 通过。
- i18n、presets、sdk、core、server、app、landing 测试通过。
- 第一次使用 `npm ci --ignore-scripts` 验证时，desktop 有 8 个 test files / 110 tests 通过，2 个 suite 因 Electron binary 未下载而未加载。补执行 `node node_modules/electron/install.js` 后，desktop 10 个 test files / 118 tests 全部通过。正式修复 PR 仍应按项目现有流程运行受影响的 Electron E2E。

以上验证使用 Node 24，证明当前代码与升级后的依赖兼容，但不能替代 CI toolchain 迁移验证。正式修复 PR 的验收范围必须包含：三个 workflow 统一切到 Node 22.19+、`npm ci`、`npm run verify`、Electron binary 下载、至少一次 desktop 打包和受影响 E2E。

`adm-zip 0.6.0` 已内置 TypeScript types；修复 PR 可顺手评估删除 `@types/adm-zip`，但这不是清除漏洞所必需，最小安全修复可暂不扩大范围。

升级 `adm-zip` 只关闭本次 CVE，不等于任意 ZIP 输入已具备完整资源上限。当前 skill 安装仍没有压缩包大小、entry 数、单 entry 展开大小和总展开大小限制；合法但巨大的 ZIP/zip bomb 仍可能消耗过多 CPU、内存或磁盘，应作为独立应用层 hardening 跟进。

## 自动化工具取舍

| 工具 | 适合职责 | 能否提修复 PR | 对 `dev` 的适配 |
|---|---|---:|---|
| Dependabot alerts | default branch 存量告警与责任跟踪 | 否 | 只扫描 default branch |
| Dependabot security updates | 基于 GitHub alerts 提最小安全版本 PR | 是 | 安全 PR 只能指向 default branch |
| Renovate | 常规更新、漏洞修复 PR、分组、冷却、dashboard | 是 | 可用 `baseBranchPatterns: ["dev"]` |
| Dependency Review | PR 依赖 diff，阻止新漏洞 | 否 | 比较 PR 与其实际 base，适合 `dev` |
| `npm audit` | 当前 lockfile 全树审计 | 否 | 可扫任意 checkout；没有稳定的 baseline/diff 机制 |
| OSV-Scanner | 全树或 PR 差分扫描、SARIF | 否（guided remediation 尚不适合作主方案） | 可扫任意 branch |

### 推荐组合

#### 1. Renovate 负责提 PR

本仓库优先 Renovate，而不是 Dependabot version/security updates，主要原因是 Renovate 能把 PR 指向 `dev`。建议配置：

- `baseBranchPatterns: ["dev"]`。
- npm minor/patch 按依赖族合理分组，每周运行；major 单独 PR。
- 常规版本设置至少 3 天 `minimumReleaseAge`，降低刚发布恶意包或撤回版本的风险。
- 漏洞修复不受普通更新日程和冷却阻塞。
- 初期不自动 merge；等 CI 和 branch ruleset 稳定后，只对通过全部 checks 的低风险 patch/minor 或 dev tooling 开 automerge。
- Electron、pi runtime、Fastify、React/Router、native dependencies 单独分组或单包 PR，不和无关 UI 工具混成一个大 PR。
- 用 dependency dashboard 暴露 pending、blocked 和 ignored 更新。

Renovate 的 repository config 默认从 GitHub default branch 读取。由于 `main` 保持 default branch，bootstrap 配置需要先进入 `main`，再用 `baseBranchPatterns: ["dev"]` 指向集成分支；仅把配置提交到 `dev` 不能假设 hosted app 会读取。

Renovate 若使用 GitHub `vulnerabilityAlerts` 生成安全 PR，告警数据仍来自 default branch `main`。`main` 与 `dev` 分叉时，`dev` 独有漏洞可能漏报。因此不能只依赖这一条通道，仍需对 `dev` 运行全树/差分扫描。

#### 2. Dependency Review 负责 PR gate

这是现有存量未清零前最合适的 required check：它比较 PR 与 base，只阻止 PR 新增脆弱依赖，不会因为 base 已有 19 项而让所有 PR 永久失败。

- 在 `pull_request`（base 为 `dev`）上运行。
- 首期 `fail-on-severity: high`，即拦 high/critical。
- 显式配置 `fail-on-scopes: runtime, development, unknown`；action 默认只拦 runtime，与本项目构建/打包依赖也执行代码的风险模型不符。
- 基线清零后再考虑提升到 moderate。
- 权限保持 `contents: read`，不需要 secrets。
- 第三方 action 使用完整 commit SHA 固定，而不是浮动 tag。

Dependency Review 依赖 GitHub dependency graph。公开仓库可使用，但仍需先在 repository settings 启用 dependency graph。

#### 3. Dependabot alerts 负责告警面板

建议启用 dependency graph 和 Dependabot alerts，即使 PR 生成交给 Renovate。它提供 advisory 详情、分派、通知和安全视图，并持续扫描稳定发布分支 `main`。不启用 Dependabot version/security update PR，避免其面向 `main` 的 PR 与面向 `dev` 的 Renovate PR 重复。

当前不建议同时开启 Renovate 和 Dependabot 的版本更新 PR，否则会重复。二选一负责 PR，其他工具负责检测/展示。

#### 4. 全树定时扫描负责新披露漏洞

PR diff gate 只能防止引入已知漏洞，无法发现“依赖未变，但明天新披露 CVE”的情况。应在 `dev` push 和定时任务上运行一次完整扫描：

- 简单方案：`npm audit --audit-level=high`。
- 更完整的开源数据库/SARIF 方案：OSV-Scanner full scan。

基线清零后 full scan 可以失败并报警；清零前不要把 `npm audit --audit-level=high` 直接设为所有 PR required check。不要用“允许最多 19 项”这类数量 baseline，数据库更新和 advisory 合并会导致计数漂移。真正无法修复的例外应按 advisory ID 记录原因、owner 和过期时间。

由于 `main` 是 default branch，scheduled workflow 必须存在于 `main`，并在 schedule 事件中显式 checkout `refs/heads/dev`；否则 schedule 只读取和运行 `main` 上的 workflow/代码。`dev` push 可以扫描当前 pushed revision。定时扫描发现 `dev` 独有漏洞后，应由维护者按响应时限创建修复 PR；普通 Renovate version update 不能保证等价于即时漏洞修复。

## Workflow 安全边界

- 执行不可信 PR 代码的 build/test/差分扫描只用 `pull_request`，使用只读 token，无 repository secrets。
- 可信 `dev` push/schedule 可运行全树扫描；若 OSV 结果上传 SARIF，需要最小增加 `security-events: write` 和 `actions: read`，否则保持只读并仅在 job log 报告。
- 不要在 `pull_request_target` 中 checkout 或执行 PR 代码，也不要在那里运行 `npm ci`、package scripts 或 Electron build。
- Dependabot PR 的 workflow token 和 secrets 按 fork PR 处理；正常 Actions secrets 不会下发。
- `npm ci` 会执行第三方 lifecycle scripts，只应在无 secrets、无写 token、临时 GitHub-hosted runner 中运行。
- 若以后增加 bot automerge/label workflow，应和执行 PR 代码的 workflow 分开；可信 workflow不 checkout head，只校验 bot 身份并启用平台 auto-merge。
- automerge 必须配合 required status checks；不能把“机器人创建的 PR”视为天然可信。

## 分阶段实施建议

### Phase 0：修复当前基线（已完成）

- 已执行兼容 lockfile refresh，未使用 `npm audit fix --force`。
- 已显式升级 `adm-zip` 到 `0.6.0`、Electron 到 `41.10.7`。
- 已将现有 workflow 和开发环境最低版本从 Node 20 统一升级到 Node 22.19+，满足 Electron 安装链和 pi runtime 的 engines 约束；`actions/checkout`、`actions/setup-node` 同步升级到 Node 24 action runtime 的 v7。
- 全量及 `--omit=dev` 审计均为 0 vulnerabilities。
- Node 24 下 `npm ci`、`npm run verify` 全部通过；最低版本 Node 22.19.0 + npm 10 下 script-enabled `npm ci`、全量审计和 `npm run verify` 全部通过且无 engine warning。
- Node 22.19.0 下 Electron 41.10.7 的 macOS arm64 unpacked 打包成功，`e2e/app-launch.spec.ts` 通过。

### Phase 1：防止回归

- 启用 GitHub dependency graph 和 Dependabot alerts。
- 增加 Dependency Review PR workflow，拦 high/critical 新增漏洞。
- 在现有 `dev` branch protection 上增加 dependency review required check；若迁移到 ruleset，保留已有的管理员保护语义。
- 先修正 `pr-build.yml` 的 `paths-ignore`：required `verify` 必须在纯文档 PR 也产生成功 check，可在 job 内条件跳过重任务，不能让整个 required workflow 不触发。
- 增加 full scan workflow，在 `dev` push/每周 schedule 上运行；workflow 需存在于 default branch `main`，且 schedule 显式 checkout `dev`。

### Phase 2：自动维护

- 安装 Renovate GitHub App。
- 在 default branch `main` 先引导 Renovate config，再用 `baseBranchPatterns: ["dev"]` 指向 `dev`；不要只把配置合入 `dev`。若采用 `useBaseBranchConfig`，启用它的 bootstrap 配置本身仍需从 default branch 生效。
- 限制并发 PR，常规 minor/patch 分组，major/高风险依赖拆分。
- 初期人工 merge；观察 2 到 4 周后再为低风险更新启用 automerge。
- 每季度清理 ignored rules 和例外，避免永久 suppress。

### Phase 3：建立跨分支修复策略

- 保持 `main` 为 GitHub default/稳定发布分支，`dev` 为日常集成分支。
- Dependabot alerts 负责发现 `main` 上已发布依赖的漏洞；Renovate、Dependency Review 和 full scan 负责 `dev`。
- `dev` 与 `main` 都受影响时，修复先进入 `dev` 并随正常发布合入 `main`；达到紧急修复门槛时，同时从 `main` 建 hotfix，并把 hotfix 变更同步回 `dev`，避免下一次发布回归。
- 为 critical、已知在野利用或本项目可达的 high 漏洞制定响应时限；普通不可达/构建链 finding 则按风险评估进入最近发布，不以 CVSS 作为唯一排序依据。
- 定期核对两条分支的 lockfile 扫描结果，避免只关闭 `main` alert、却让 `dev` 在下一次发布重新引入同一漏洞。

## 一般实践

成熟的依赖治理不是“定期跑一次 audit”，而是四个互补环节：

1. Inventory：提交 lockfile，维护 dependency graph/SBOM，知道实际解析了什么。
2. Prevent：在 PR 上做差分扫描，阻止新增脆弱依赖。
3. Detect：对主干定时全树扫描，捕获后来披露的漏洞。
4. Remediate：机器人提最小、可测试的升级 PR，人或受控 automerge 完成合入。

漏洞优先级不只看 CVSS，还要结合 direct/transitive、runtime/build、是否处理不可信输入、网络暴露、可达性、修复成本和 EPSS/已知利用情况。当前项目中 `adm-zip` 处理外部 ZIP，是“高危且可达”的典型；构建链漏洞虽然通常不在终端用户运行时可达，也不能从供应链治理中删除。

## 权威资料

- GitHub Dependabot alerts（只扫描 default branch）：https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-alerts
- GitHub Dependabot security updates：https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-security-updates
- Dependabot `target-branch` 限制：https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#target-branch--
- GitHub Dependency Review：https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review
- npm audit：https://docs.npmjs.com/cli/v11/commands/npm-audit/
- Renovate configuration：https://docs.renovatebot.com/configuration-options/
- Renovate security and permissions：https://docs.renovatebot.com/security-and-permissions/
- OSV-Scanner GitHub Action：https://google.github.io/osv-scanner/github-action/
- `adm-zip 0.6.0` release notes：https://github.com/cthackers/adm-zip/releases/tag/v0.6.0
