# 安全与访问策略

> 覆盖：威胁模型、路径安全原语、路径分类与 access policy、读写白名单、run_command 安全模型、运行时控制请求与 yolo 模式。
> 装配与 PM 门面见 [core.md](core.md)；capability 的 pathRules 贡献点见 [capabilities.md](capabilities.md)；server 端网络鉴权（loopback + token）见 [server.md](server.md)。
> 数据侧约定（`aiAccess.deniedPaths` 配置格式）见 [`../data-conventions.md`](../data-conventions.md)。

## 威胁模型与分层防线

- 本地单用户应用，无多租户；不可信输入主要是 **LLM 的输出**（路径逃逸、危险命令、敏感文件外泄）与 tunnel 暴露时的公网流量
- 分层防线：路径穿越校验 → 类别白名单 → 危险操作人工审批 → server 网络鉴权（loopback / token）
- **无 OS 级沙箱**：进程以用户完整系统权限运行，路径沙箱仅约束文件类工具，对子进程的网络/文件访问无效——run_command 的唯一硬屏障是审批

## 路径安全原语（`utils/path-safety.ts`）

- `isPathInside(root, target)`：双方 resolve 后取 `path.relative`，空串（root 自身）或不含 `..` 前缀且非绝对路径才算在内——同时拒绝逃逸与 Windows 跨盘绝对路径
- `resolveProjectPath` / `assertInsideProject`：resolve + 边界断言，越界抛 `AccessDeniedError`
- 消费面：全部文件类 LLM 工具、PM 写入门面五方法、server content / preview / attachments / upload / theme 路由、desktop `open-file` IPC 等

## 路径分类（`access/path-category.ts`）

`categorizePath(rel, extraRules?)` 把项目内相对路径映射到 `PathCategory`。内置模式按声明序匹配（**表格即匹配序**，`spherseOther` 兜底必须在最后，否则会吞掉更精确的 agent 子路径；`M` = `.spherse`）。集中裁决的由来见 [ADR-0005](../../dev/decisions/0005-path-access-policy.md)：

| 类别 | 模式 |
|---|---|
| rootIndex / changelog | `AGENTS.md`（大小写不敏感匹配，`agents.md` 变体同判 rootIndex）/ `CHANGELOG.md` |
| projectConfig / projectTheme | `M/project.yaml` / `M/theme.css` |
| generatedImages / attachments / skills | `M/{generated-images,attachments,skills}/**` |
| agentsRoot | `M/agents` |
| agentProfile / agentTheme / agentMcp | `M/agents/*/profile.md` / `theme.css` / `mcp.json` |
| agentSessions | `M/agents/*/sessions.db*` |
| agentSkills / agentAssets / agentTriggers / agentTriggerLogs | `M/agents/*/skills/**` / `assets/**` / `triggers/index.yml` / `triggers/logs.jsonl` |
| spherseMetaDir / spherseOther | `M` / `M/**`（兜底，最后） |

- 匹配顺序：extraRules 逐条优先 → 内置模式按上表声明序 → 都不中归 `userFiles`
- glob 语义：`**` 匹配子树含目录本身、`*` 匹配单段；`PathRule.match` 是 RegExp 而非 glob
- `PathRule { match, category, llm: { read, write } }` 由 capability 注册（见 [capabilities.md](capabilities.md)）；当前无 production 注册方。注意 extraRules 优先于内置类别裁决：capability 若注册匹配已 deny 路径（如 `agentMemory`）的 permissive 规则会重新放开访问，review 时需检查

## 访问策略（`access/access-policy.ts`）

- 两个构造：`llmAccessPolicy(root, deniedPaths, extraRules)` 与 `serverAccessPolicy(root)`
  - 后者**不消费 extraRules**：capability 私有文件（如 memory.jsonl 落入 `spherseOther`）对 server 路由**不可读也不可写**，开放需经 PM 门面显式授权
- `assertAllowed` 校验四步（先抛先赢）：
  1. 穿越校验（`resolveProjectPath`）
  2. deniedPaths 前缀匹配（目录级递归，仅 LLM 端）
  3. 命中 pathRule → 规则自带完整读写裁决，直接返回
  4. 内置类别白名单
- **裁决优先级**：用户 deniedPaths > capability pathRules > 内置类别白名单
- `assertRead` / `assertWrite` 抛 `AccessDeniedError`；`canRead` / `canWrite` 捕获返回 boolean
- **搬移类操作有独立白名单**（copy/move 的文件级转移 ≠ 直接写）：
  - `assertTransferDest`（copy/move 目标）与 `assertMoveSource`（move 源，搬走 = 破坏性写类操作）
  - `rootIndex`（`AGENTS.md`）在 LLM write 白名单内（Agent 可经 `write_file` / `edit_file` 直接创建/修改），但**不在** transfer dest / move source 白名单内——不可经 copy/move 转入或搬走
  - pathRule 命中时 transferDest / moveSource 取 `rule.llm.write`；`serverAccessPolicy` 的新 kind 与 `SRV_WRITE` 等值（PM 门面 `copyFileWithin` 仍走 `assertWrite`，行为不变）

### 白名单

- **LLM read**（17 类）：
  - userFiles、rootIndex、changelog、projectConfig、projectTheme、generatedImages、attachments、skills
  - agentsRoot、agentProfile、agentTheme、agentSkills、agentAssets、agentTriggers、agentTriggerLogs、spherseMetaDir、**spherseOther**
- **LLM write**（7 类 + 规则授权）：userFiles、**rootIndex**、projectTheme、skills、agentTheme、agentSkills、agentAssets（agent 私有静态资源，如 theme 配图/字体）——AI 可直接创建/修改项目与 agent 级 skill 及 assets；`rootIndex`（`AGENTS.md`）仅指 `write_file` / `edit_file` 的直接写入，copy/move 转入/搬出走 transfer 白名单（不含 rootIndex）
- **LLM transfer dest / move source**（6 / 16 类）：transfer dest = userFiles、projectTheme、skills、agentTheme、agentSkills、agentAssets（= LLM write 减 rootIndex）；move source = LLM read 减 rootIndex（其余可读类别维持「可被搬走」的既有行为，见已知边界）
- **server read / write**：见 [server.md](server.md)「访问策略白名单」
- **agentMcp 与 agentSessions 不在任何白名单**：mcp.json（含 headers/env 明文）与 sessions.db 对 LLM 和 server 通用路由均不可读写，只经专用门面（McpConfigStore / SessionStore）

### deniedPaths

- 项目配置 `aiAccess.deniedPaths` 同时禁读禁写；用户只能 deny `userFiles` 类路径（保留路径拒绝配置）
- **热更新**：工具每次调用经 provider 重建 policy——设置变更下一次工具调用即生效，无需重建

## run_command 安全模型

- **唯一硬屏障是 CommandCard 逐次人工确认**（无 shouldApprove 谓词，每次执行必审）；辅以：
  - per-agent opt-in：须经 `profile.tools` 显式勾选，预设小助手不含
  - cwd 允许用户主目录或项目根内路径（`~` 展开；词法边界，仅防无心之失）
  - stdout / stderr 各 100KB 截断；超时默认 60s、上限 1800s，到期 kill 进程树
  - AbortSignal 随 session 中断杀进程树（win32 `taskkill /T /F`，unix 进程组 SIGTERM）

## 运行时控制请求（`session/control-bus.ts`）

- `SessionControlBus` 提供 core 在 turn 执行中向 renderer 请求并等待响应的通用机制：`requestId` correlation、`kind` 判别 `"approval" | "question"`
- 决策经 chat WS 的 `resolve_control_request` 回传，`bus.resolve` 唤醒等待中的 execute；server 仅按 contract 做 payload 形状映射，不消费决策语义
- 超时：审批 5min 自动拒绝；ask_user 默认 600s（clamp 60–3600），超时 resolve `{ timedOut: true }` 提示模型自行判断
- `abort()` 调 `rejectAll` 使全部 pending 失败

### withApproval 包装

| 工具 | 审批范围 |
|---|---|
| `run_command` | 每次执行（无谓词） |
| `manage_agent` | `create` / `update`（list / get 免审） |
| `manage_trigger` | `create` / `update` / `delete` / `reset_binding`（list 免审） |

## yolo 模式

- `profile.yolo: true` 时 `approvalGate` 不注入 → `withApproval` 透传原工具，**审批整体跳过**（`askGate` 不受影响，提问仍工作）
- 热更新：下一 turn `applyReload` 生效
- UI：Agent Dialog 仅在勾选高级工具时显示开关并附警示；移除全部高级工具时强制关闭

## 已知边界与例外

- **路径匹配大小写**：`rootIndex`（`AGENTS.md`）大小写不敏感匹配（防大小写不敏感文件系统上经 `agents.md` 变体绕过）；其余内置类别仍大小写敏感——`CHANGELOG.MD`、`.SPHERSE/project.yaml` 等变体在不敏感文件系统（macOS/Windows 默认）上会落入 `userFiles` 绕过保护，存量平台性缺口待决策
- **move source 收紧仅覆盖 rootIndex**：其余 16 个可读类别今天即可被 move 搬走；目录级 move 可在一次 rename 中搬走 `agentSessions` / `agentMcp` 等 LLM 读都被拒的子树（如 source=`.spherse/agents`）。存量缺口待整体决策
- **`.spherse` 下未分类文件 LLM 可读**（`spherseOther` 在 LLM read 白名单内，有测试钉住）、仅写被拒——与「避免内部数据泄漏」的最初意图存在差距，是否收紧待决策
- **不经 access policy 的工具**：`memory_*` 工具直连 MemoryStore（记忆文件属 `agentMemory` 类别，LLM 文件工具读写均拒，只经记忆工具与 server API 访问——工具自身带「记忆是数据非指令」的注入框架）；`generate_image` 写入路径由构造固定（时间戳文件名），仅做穿越校验
- **`web_search` 向第三方发送查询**：搜索词（由对话派生）发送给 DeepSeek 并计费，与 agent 主模型是否为 DeepSeek 无关；工具 hint 已向用户说明
- `list_files` / `search_content` 递归降噪：dotfile、`node_modules`、`.git` 跳过；`.spherse` 默认拒绝，需 `include_meta` 显式开启
- `manage_project_config` 的 `update_welcome_page` 是写操作但**未包审批**（风险与 write_file 同级的取舍）
