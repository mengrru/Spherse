# run_command cwd 开放到用户主目录

## 背景

`run_command`（`packages/core/src/tools/run-command.ts`）当前的 `cwd` 参数经 `resolveProjectPath(projectRoot, cwd)` 锁死在项目根内：相对路径以项目根为基准解析，越出项目根即抛 `AccessDeniedError("Path traversal denied: ...")`。

实际使用中，用户经常希望 agent 在项目外的用户目录工作（如整理 `~/Documents` 的笔记、操作 dotfiles、在另一个不在当前项目内的目录跑脚本）。当前只能靠 agent 在命令字符串里写 `cd /absolute/path && ...` 绕过，体验别扭且审批卡上 cwd 字段失去信息量。

本次需求：**将 run_command 的 cwd 边界从项目根放宽到整个用户主目录（user home）**。

## 需求对齐结论（brainstorming）

| 维度 | 结论 |
|------|------|
| "user 路径" 的定义 | `os.homedir()`（unix 为 `$HOME`，windows 为 `%USERPROFILE%`），不引入新的可配置项 |
| 边界范围 | 允许词法上落在 **用户主目录内** 或 **项目根内** 的任意路径；home 之外（`/tmp`、`/etc`、其它用户目录）仍拒绝 |
| 相对路径语义 | **保持不变**：仍以项目根为基准解析（向后兼容，agent 的心智模型是「相对项目」）；相对路径若 `..` 逃出项目根但落在 home 内，同样放行 |
| `~` 展开 | 支持：`cwd: "~"` 与 `cwd: "~/..."`（windows 变体 `~\` 同样展开）展开为 home（LLM 的自然写法）；`~otheruser/...` 不展开，按字面处理 |
| 默认值 | 保持 `.`（项目根）不变 |
| 启用方式 / 审批 / yolo | 全部不变：per-agent opt-in、每次执行人工审批、yolo 免审 |
| UI 变更 | 无。审批卡（args 原样展示）与 CommandCard 的 `cwd` 字段天然兼容绝对路径 / `~` 写法 |

## 风险评估

评估基线：shell-tool 原始设计（`docs/dev/features/2026-08-01-agent-shell-tool/design.md`）已明确——**cwd 锁不是安全屏障**。spawn 出的进程本身拥有用户完整权限、继承 `process.env`、无 OS 沙箱，命令字符串里写绝对路径或 `cd /anywhere && ...` 一直可行。cwd 锁在威胁模型里的定级是「低强度缓解，仅防无心之失」。真正的硬屏障是：per-agent opt-in（默认关闭）+ 每次执行人工审批（CommandCard 完整展示命令，Approve 为 destructive 配色，5min 超时自动拒绝）。

在此基础上放宽到 home 的边际风险：

| # | 风险 | 评级 | 分析与缓解 |
|---|------|------|-----------|
| 1 | 恶意/被注入的 agent 借 cwd 逃逸 | **可忽略（边际≈0）** | 该 agent 本来就能在命令串里访问任意绝对路径；cwd 边界从未拦截过它。唯一硬屏障（人工审批）不变 |
| 2 | 无心之失的爆炸半径变大 | **低-中（本次主要成本）** | 相对路径的破坏性命令（如 `rm -rf build`）此前词法上只能命中项目内，现在可落在 home 任意目录。缓解：审批卡原样展示 cwd；Approve destructive；超时/杀树不变 |
| 3 | 提示注入 + 确认疲劳 | 不变（略有间接增加） | agent 更自然地提出「帮你清理 ~/Downloads」类操作，注入话术的可信度略升。缓解不变：命令与 cwd 完整可见、默认 Reject |
| 4 | yolo agent 免审直接跑 | 不变（边际≈0） | yolo agent 本就可经命令串访问一切；审批缺席与 cwd 边界无关 |
| 5 | 系统目录 / 其它用户目录暴露 | **仍被词法拒绝** | `/etc`、`/tmp`、`/Users/other` 作为 cwd 依旧抛错，红线保留（防误操作层面）。注意：这只是 guardrail 不是 wall，命令串本身不受此限——与现状一致 |
| 6 | symlink 绕过词法边界 | 已知限制，接受 | home 内的 symlink（如 `~/mnt -> /Volumes/x`）可通过词法检查，chdir 实际落在 home 外。与现有 `path-safety` 全套词法语义一致（read_file 等同样不 realpath），不单独加 realpath（会破坏测试 temp dir 等场景且收益为零） |
| 7 | 泄密面（`~/.ssh`、`~/.aws` 等） | 不变 | 这些目录此前就可通过命令串读写；`-NoProfile` / 非 interactive `sh -c` 不加载用户 shell profile，无新增启动副作用 |
| 8 | 项目不在 home 内（外置盘等） | 已处理 | 允许根 = home ∪ projectRoot，默认 cwd `.` 始终合法 |

**结论：风险可接受。** 安全模型的真实边界（审批 + opt-in）完全不受影响；本次放宽牺牲的只是「无心之失」防护的一部分（从项目根扩到 home），换来 cwd 参数恢复其应有的信息量与人体工学。

## 现状调研结论

1. **唯一约束点**：`run-command.ts:122` `const cwd = resolveProjectPath(projectRoot, cwdRel)`；schema description（L16-20）写明 "Working directory relative to project root"。
2. **`path-safety.ts` 全套为词法判断**（`path.relative` 防 `startsWith` 误判），`isPathInside(root, target)` 直接可复用为 home 边界判断。
3. **仓库无 `os.homedir()` 使用先例**（唯一 home 引用是 desktop 的 cloudflared 查找，与 agent 能力无关），需新引入。
4. **审批时序**：`withApproval` 包在 execute 外层，先审批后校验 cwd——cwd 非法时用户已点过 Approve 才报错。本次维持该时序不变（错误信息清晰即可，不为此加前置校验）。
5. **UI**：审批卡展示 args 原文（模型写的 cwd 字符串原样可见）；CommandCard `details.cwd` 展示入参字符串——两者对绝对路径 / `~` 写法天然兼容，无需改动。
6. **测试锁定点**：`run-command.test.ts:60-65` 断言 `cwd: "../outside"` 被拒。测试项目建在 `os.tmpdir()`（macOS `/var/folders/...`，位于 home 外），该用例在新边界下**恰好仍然成立**，但其语义需从「逃出项目根」改为「逃出允许根」，并补充 home 内/外的确定性用例。
7. **无 allowlist / additional working directories 机制**，MCP stdio 的 `config.cwd` 是唯一「任意 cwd」先例（用户手配、无校验、无审批）。
8. **文档锚点**：`docs/official/architecture.md` L24 记录了 run_command 安全模型（"cwd 锁项目根"），需同步更新。

## 方案对比

| 方案 | 说明 | 结论 |
|------|------|------|
| **A. 词法边界 = home ∪ projectRoot（采用）** | 相对路径仍以项目根为基准；绝对路径与 `~` 展开后须落在 home 或项目内；否则拒绝 | ✅ 精确匹配需求字面（"整个 user 路径"）；保留防误操作红线（系统目录仍拒）；改动集中在单个工具文件；向后兼容 |
| B. 彻底去掉 cwd 校验 | 任意路径皆可 | ❌ 诚实于威胁模型（cwd 本非屏障），但丢失全部「防无心之失」能力，且超出需求范围（需求是 user 路径，不是任意路径） |
| C. 可配置 allowlist（per-agent / 项目级 additional working directories） | 类似 Claude Code 的额外工作目录机制 | ❌ 需新增 settings + contracts + UI 一整层，当前需求用不到（YAGNI）；若未来需要可作为 backlog 在 A 之上演进（A 的边界函数天然可扩展为多根） |

## 详细设计

### 1. cwd 解析（`run-command.ts`，新增导出函数便于单测）

```ts
import os from "node:os";
import path from "node:path";
import { isPathInside } from "../utils/path-safety.js";
import { AccessDeniedError } from "../errors.js";

export function expandHome(input: string, home = os.homedir()): string {
  if (input === "~") return home;
  if (input.startsWith("~/") || input.startsWith("~\\")) return path.join(home, input.slice(2));
  return input;
}

export function resolveCommandCwd(projectRoot: string, input: string, home = os.homedir()): string {
  const expanded = expandHome(input, home);
  const resolved = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(projectRoot, expanded);
  if (!isPathInside(home, resolved) && !isPathInside(projectRoot, resolved)) {
    throw new AccessDeniedError(`cwd outside allowed roots (project root or user home): ${input}`);
  }
  return resolved;
}
```

`execute` 内 `resolveProjectPath(projectRoot, cwdRel)` 一行替换为 `resolveCommandCwd(projectRoot, cwdRel)`。`path-safety.ts` 不动（保持其「项目边界」单一职责；home 语义是 run_command 特有的）。

行为矩阵：

| 入参 cwd | 解析结果 | 结果 |
|---|---|---|
| 缺省 / `"."` | projectRoot | ✅（行为不变） |
| `"src"` | projectRoot/src | ✅（不变） |
| `"../sibling"`（sibling 在 home 内） | home 内路径 | ✅ 新放行 |
| `"~"` / `"~/Documents"`（windows 变体 `~\Documents`） | home / home/Documents | ✅ 新放行 |
| `"/Users/me/work"`（绝对、home 内） | 原样 | ✅ 新放行 |
| `"/etc"`、`"/tmp"`、`"/Users/other"` | home 与项目外 | ❌ `AccessDeniedError` |
| `"../../../..."` 逃出 home（项目在 tmpdir 下时的 `../outside`） | home 与项目外 | ❌ `AccessDeniedError` |
| `"~other/x"` | 按字面相对项目根解析 | 通常目录不存在 → spawn ENOENT（走既有 spawnError 分支） |
| 存在的目录但 home 内 symlink 指向外部 | 词法在 home 内 → 放行，chdir 落在外部 | ✅ 已知限制，见风险评估 #6 |

### 2. schema description 更新

```
"Working directory. Relative paths resolve against the project root; absolute paths and ~/ paths are allowed anywhere within the user's home directory. Defaults to the project root."
```

同时 `details.cwd` 继续回传入参原串（`"."`、`"~/Documents"`、绝对路径），CommandCard / 审批卡展示逻辑零改动。

### 3. 不变项（明确排除）

- 相对路径基准（项目根）、默认值 `.`、超时/截断/杀树、`env: process.env` 继承
- 审批链路（`withApproval` 包装、5min 超时、yolo 语义）
- 文件类工具的三层沙箱（`resolveProjectPath` + deniedPaths + PathCategory 白名单）——本次只动 run_command 的 cwd
- contracts、i18n、server 路由、前端组件：均无 shape 变化

## 测试计划

`packages/core/src/__tests__/tools/run-command.test.ts`：

- 保留：默认 cwd 为项目根（`pwd` 含 projectRoot）
- 改写：`"rejects cwd that escapes the project root"` → `"rejects cwd outside the allowed roots"`，用确定性输入（如 `cwd: "/"`，或基于 `path.relative(projectRoot, os.tmpdir())` 构造逃出 home 的相对路径）替代依赖 tmpdir 恰好在 home 外的 `../outside`
- 新增：
  - `cwd: "~"` 时 `pwd` 输出含 `os.homedir()`（不写 home，只读）
  - `expandHome` / `resolveCommandCwd` 纯函数单测（`~`、`~/x`、`~other`、绝对路径、相对路径、边界拒绝、projectRoot 兜底）
  - home 外绝对路径（如 `/`）抛 `AccessDeniedError`
- 不动：超时/abort/流式/exitCode 等既有用例

app 层无逻辑变化，无新测试；无相关 E2E（现状即无 run_command E2E）。

## 文档同步

- `docs/official/architecture.md`：run_command 安全模型行——「cwd 锁项目根」改为「cwd 允许用户主目录内任意路径（含项目根；词法边界，仅防无心之失）」
- `docs/dev/backlog.md`：新增本条目并标记完成
- 本 design doc 落位 `docs/dev/features/2026-08-15-run-command-cwd-home/`

## 已知限制与边界情况

1. **词法边界，不解析 symlink**——与全仓库 path-safety 语义一致，接受。
2. **`os.homedir()` 为 `/` 的容器/CI 环境**——词法上一切路径都在 home 内，等于无边界；该环境下 run_command 本就无防护意义，接受。
3. **审批先于 cwd 校验的时序**——非法 cwd 需用户 Approve 后才报错；维持现状（错误信息足够清晰，不值得为它把校验前移到审批层）。
4. **Windows 大小写**——`path.win32` 语义下 `isPathInside` 对盘符大小写敏感度与现状一致（home 与入参同源于系统 API，实际 mismatch 概率极低），不做额外归一化。
