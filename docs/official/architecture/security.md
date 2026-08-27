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
- 消费面：全部文件类 LLM 工具、PM 写入门面五方法、server content / preview / attachments / theme 路由、desktop `open-file` IPC 等

## 路径分类（`access/path-category.ts`）

`categorizePath(rel, extraRules?)` 把项目内相对路径映射到 `PathCategory`。内置模式按声明序匹配（**表格即匹配序**，`spherseOther` 兜底必须在最后，否则会吞掉更精确的 agent 子路径；`M` = `.spherse`）：

| 类别 | 模式 |
|---|---|
| rootIndex / changelog | `AGENTS.md` / `CHANGELOG.md` |
| projectConfig / projectTheme | `M/project.yaml` / `M/theme.css` |
| generatedImages / attachments / skills | `M/{generated-images,attachments,skills}/**` |
| agentsRoot | `M/agents` |
| agentProfile / agentTheme / agentMcp | `M/agents/*/profile.md` / `theme.css` / `mcp.json` |
| agentSessions | `M/agents/*/sessions.db*` |
| agentSkills / agentTriggers / agentTriggerLogs | `M/agents/*/skills/**` / `triggers/index.yml` / `triggers/logs.jsonl` |
| spherseMetaDir / spherseOther | `M` / `M/**`（兜底，最后） |

- 匹配顺序：extraRules 逐条优先 → 内置模式按上表声明序 → 都不中归 `userFiles`
- glob 语义：`**` 匹配子树含目录本身、`*` 匹配单段；`PathRule.match` 是 RegExp 而非 glob
- `PathRule { match, category, llm: { read, write } }` 由 capability 注册（见 [capabilities.md](capabilities.md)）；当前注册方仅 memory（`.spherse/agents/*/memory.jsonl` → 自定义类别 `memory`，LLM 读写均放行）

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

### 白名单

- **LLM read**（16 类）：
  - userFiles、rootIndex、changelog、projectConfig、projectTheme、generatedImages、attachments、skills
  - agentsRoot、agentProfile、agentTheme、agentSkills、agentTriggers、agentTriggerLogs、spherseMetaDir、**spherseOther**
- **LLM write**（5 类 + 规则授权）：userFiles、projectTheme、skills、agentTheme、agentSkills——AI 可直接创建/修改项目与 agent 级 skill
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

- **`.spherse` 下未分类文件 LLM 可读**（`spherseOther` 在 LLM read 白名单内，有测试钉住）、仅写被拒——与「避免内部数据泄漏」的最初意图存在差距，是否收紧待决策
- **不经 access policy 的工具**：`memory_save` / `memory_recall` 直连 MemoryStore（deny `.spherse` 拦不住 memory 持久化）；`generate_image` 写入路径由构造固定（时间戳文件名），仅做穿越校验
- `list_files` / `search_content` 递归降噪：dotfile、`node_modules`、`.git` 跳过；`.spherse` 默认拒绝，需 `include_meta` 显式开启
- `manage_project_config` 的 `update_welcome_page` 是写操作但**未包审批**（风险与 write_file 同级的取舍）
