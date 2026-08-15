# Design：放宽 run_command 超时上限（10min → 30min）

- 日期：2026-08-15
- 状态：设计定稿，待实现
- 需求：`run_command` 执行长任务（构建、安装、训练、大批量处理）时，10 分钟上限不够用，超时即被 kill。需放宽上限，并决策是 hardcode 更长的时间还是采用其它策略。

## 背景

### 现状（代码事实）

`packages/core/src/tools/run-command.ts`：

| 常量 | 值 | 说明 |
|---|---|---|
| `DEFAULT_TIMEOUT_MS` | 60_000 | LLM 未传 `timeout_ms` 时的默认超时 |
| `MIN_TIMEOUT_MS` | 1_000 | 下限 |
| `MAX_TIMEOUT_MS` | 600_000（10min） | **本需求要放宽的上限** |

- `timeout_ms` 是 **LLM 每次工具调用时传的参数**（非用户配置），`clampTimeout` 将其 clamp 到 `[1s, 10min]`；超时后 `killProcessTree` 杀整个进程树。
- 与之独立的概念勿混淆：**审批等待超时 5min**（`SessionControlBus`，超时自动拒绝），不在本需求范围，保持不变。
- 其它既有约束（均不变）：stdin `ignore`（交互式命令会挂死到超时为止——这正是超时兜底的价值）、stdout/stderr 截断 100KB、cwd 锁项目根、AbortSignal 随 session 中断杀进程树。

### 关联风险背景

`docs/dev/features/2026-08-15-ui-sdk-silent-send-risk-assessment/design.md` 已标记：detached run（静默发送）中 yolo agent 的 `run_command` 无人监看，挂死命令会阻塞 session（其 M2「detached run 门控工具 fail-fast」为已规划的收敛手段）。放宽上限会放大该场景的最长阻塞时间，见「风险」节。

## 方案

### 备选对比

| 方案 | 做法 | 评估 |
|---|---|---|
| **A. 提高硬编码上限（选定）** | `MAX_TIMEOUT_MS` 600s → 1800s（30min） | 改动最小（常量 + 参数描述 + 测试 + 文档）。上限本质是「防挂死护栏」而非精确预算，30min 覆盖绝大多数构建/安装/训练任务 |
| B. A + 调大默认值 | DEFAULT 60s → 5~10min | 普通命令（`ls`、`npm test`）挂死时也要等很久才失败，防挂死能力下降，不选 |
| C. per-agent 可配置 | agent profile 增加超时上限设置项 | 需动 profile schema、agent-dialog UI、i18n，工作量约 3-4 倍；当前无差异化诉求，记 backlog |
| D. 超时可续期 | 临近超时经 control bus 问用户「是否继续等」 | 打断心流；detached run 无人应答退化为拒绝；实现复杂，不选 |
| E. 后台执行模式 | `background: true` 立即返回 job id，agent 轮询输出 | 根因解法（长任务不阻塞回合、天然支持任意时长），但是新机制非「放宽」，超出本需求范围，记 backlog 作为演进方向 |

### 选定方案：A

1. `MAX_TIMEOUT_MS`：`600_000` → `1_800_000`（30min）。`MIN_TIMEOUT_MS` / `DEFAULT_TIMEOUT_MS` 不变。
2. **强化 `timeout_ms` 参数 description**：除更新 max 值外，增加引导语——长任务（构建/安装/训练）应显式传入预估时长，而非依赖默认值。缓解「模型忘传参 → 60s 被杀」的主要失败模式（代价仅是重试一轮，可接受）。
3. 30min 而非 60min / 无上限的理由：护栏定位下 60min 边际收益低；无上限会使 yolo + detached run 中挂死命令无限阻塞 session（M2 落地前不可接受）。
4. 涉及文件：
   - `packages/core/src/tools/run-command.ts`（常量 + description）
   - `packages/core/src/__tests__/tools/run-command.test.ts`（clamp 单测）
   - `docs/official/architecture.md`（「超时（默认 60s，上限 600s）」→ 30min，实现时同步）
   - `docs/dev/backlog.md`（勾选本条目）

## 接口与数据

- 工具参数 schema **形状不变**：`{ command, cwd?, timeout_ms? }`，仅 `timeout_ms` 的 description 文案与 clamp 上限变化。对 LLM 是纯放宽：此前 `>600_000` 的值被 clamp 至 600s，现 clamp 至 1800s。
- **无** agent profile / agent-dialog UI / i18n / server contract / 持久化数据变更，无迁移。
- 为使 clamp 规则可直接单测，参照 `buildSpawnTarget` 先例导出 `clampTimeout`。
- 未来演进（已记 backlog，非本需求范围）：
  - **后台执行模式（E，根治方向）**：`background: true` + job id 轮询，长任务不再阻塞 agent 回合；
  - per-agent 超时上限配置（C）：长任务成为常态且不同 agent 需差异化时再做；
  - CommandCard 运行态展示「已运行 X min / 剩余 Y min」：静默长任务的用户感知优化。

## 测试策略

`packages/core/src/__tests__/tools/run-command.test.ts`：

- 新增 `clampTimeout` 单测：`clampTimeout(undefined) === 60_000`、`clampTimeout(100) === 1_000`、`clampTimeout(600_001) === 1_800_000`（锁定新上限，防回归到 600s）、`clampTimeout(9_999_999) === 1_800_000`。
- 既有用例回归：超时 kill（`timeout_ms: 150` 的 `sleep 5`）、abort 中途杀进程、cwd 越界拒绝、stdout/exit code 捕获——均不受影响。
- 无 UI / 路由 / server 变更，不需 E2E。

## 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 长任务阻塞 agent 回合最长 30min，期间该 session 停留在该 tool call | 中 | 用户可随时中断 session（AbortSignal 杀进程树）；模型可自行设更短超时 |
| yolo + detached run 挂死命令的最长阻塞从 10min 升至 30min，且无人监看 | 中 | 依赖已规划的 M2「detached run 门控工具 fail-fast」收敛；本设计显式接受该残余风险（有界） |
| 静默长任务用户感知弱（CommandCard 无剩余时间展示） | 低 | 可选优化记 backlog |
| 100KB 输出截断对超长任务日志不友好 | 低 | 现状不变，非本需求引入 |
| 实现时误改审批 5min 超时（两个超时概念易混） | 低 | 测试策略明确不触碰 `SessionControlBus`；实现时对照本节自查 |
