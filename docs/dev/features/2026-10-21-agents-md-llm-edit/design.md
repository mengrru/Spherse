# 开放 Agent 对项目根 AGENTS.md 的编辑权限

## 背景

产品需求：允许 Agent 编辑项目根的 `AGENTS.md`。现状是 `categorizePath` 把根目录精确匹配的 `AGENTS.md` 归为 `rootIndex`（`packages/core/src/access/path-category.ts:34`），而 `LLM_WRITE` 白名单不含 `rootIndex`（`access-policy.ts:37-44`），`write_file` / `edit_file` 的 `assertWrite` 因此拒绝；用户 UI 走 content 路由 → `PM.writeFile` → `serverAccessPolicy`（`SRV_WRITE` 含 `rootIndex`），一直可编辑（另有不经 policy 的内部门面 `PM.updateIndex`，当前无路由消费方）。该限制来自 2026-06-22 path-access-policy 改造，设计文档当时已预留「如需保留 AI 直写 `AGENTS.md`，可把 `rootIndex` 加回 LLM write 白名单」。

### Tech lead 已确认的三项决策

1. **move 搬走 `AGENTS.md` 本次顺手收紧**：现状 `move_file` 对 source 只做 read 检查（`move-file.ts:33`），`rootIndex` 可读 ⇒ Agent 今天就能把 `AGENTS.md` 搬走/改名（等效从根删除）。收紧后禁止。
2. **copy/move 以 `AGENTS.md` 为目标仍然拒绝**：只开放 `write_file` / `edit_file` 的直接写入（含新建），不开放经 copy/move 批量转入。
3. **denylist 维持保留**：`rootIndex` 仍不可加入用户 deniedPaths；用户控制走既有机制（Agent 工具启用配置、`run_command` 逐次审批）。

## 设计

### 1. 策略模型：为搬移类操作引入操作粒度

`write_file` / `edit_file` 与 `copy_file` / `move_file` 的写语义不同：前者是内容级创建/修改，后者是文件级转移。`rootIndex` 只放开前者。`access-policy.ts` 改动：

- `LLM_WRITE` 加入 `rootIndex`（直接写白名单：`write_file` / `edit_file` 的 `assertWrite`）
- 新增 `LLM_TRANSFER_DEST`：copy/move 的目标白名单 = 原 `LLM_WRITE` 六类（userFiles、projectTheme、skills、agentTheme、agentSkills、agentAssets），**不含** `rootIndex`
- 新增 `LLM_MOVE_SOURCE`：move 的源白名单 = `LLM_READ` 减 `rootIndex`（其余类别与现状等价——move source 原本就是 read 检查；唯一例外见 pathRule 条目）
- `AccessPolicy` 接口新增 `assertTransferDest` / `assertMoveSource`（含 `canTransferDest` / `canMoveSource` 变体，复用现有 `check` helper）
- `assertAllowed` 的 `action` 扩展为 `"read" | "write" | "transferDest" | "moveSource"`：穿越校验、deniedPaths 前缀检查、pathRule 命中三步对所有 kind 一致；pathRule 裁决上 `transferDest` / `moveSource` 取 `rule.llm.write`（写类操作）——move source 从现状的 `rule.llm.read` 变为 `rule.llm.write` 是有意收紧（搬走 = 写类/破坏类操作），当前无 production pathRules 注册方，无运行时影响；错误消息把 kind 映射为可读短语（`move source of` / `transfer destination of`），沿用 `Access denied: ...` 模式
- `serverAccessPolicy` 新 kind 复用 `SRV_WRITE` 集合实现（server 端语义 = 用户可删即可搬）；PM 门面不改接线——`PM.copyFileWithin`（图片导出路由消费）继续走 `assertRead` + `assertWrite`，行为不变

### 2. rootIndex 匹配大小写不敏感（收紧有效性前提）

macOS（APFS）/ Windows（NTFS）默认大小写不敏感文件系统上，`agents.md` 与 `AGENTS.md` 是同一文件，而 `categorizePath` 匹配大小写敏感 ⇒ `agents.md` 落入 `userFiles`：今天的写保护与本次的 move source 收紧都可被大小写变体绕过。因此本次同步把 `rootIndex` 模式改为大小写不敏感匹配（`path-category.ts` 中为该类别附加 case-insensitive flag，实现上仅影响此一类别的 glob→regex 编译）。`agents.md` 变体统一按 `rootIndex` 裁决：读 ✓、write/edit ✓（新权限）、move source ✗、denylist 保留。副作用仅在于大小写敏感平台（Linux）上 `agents.md` 变体也被按 rootIndex 裁决（过度保护而非保护不足）。`changelog` / `.spherse` 系列的同类平台性缺口为本轮显式不处理的存量问题（见「已知边界」）。

### 3. 工具接线（`tools/`）

| 工具 | 改前 | 改后 |
|---|---|---|
| `write-file.ts` | `assertWrite` | 不变（`rootIndex` 随 `LLM_WRITE` 放开） |
| `edit-file.ts` | `assertRead` + `assertWrite` | 不变 |
| `copy-file.ts` | source `assertRead` + dest `assertWrite` | dest 改 `assertTransferDest` |
| `move-file.ts` | source `assertRead` + dest `assertWrite` | source 改 `assertMoveSource`，dest 改 `assertTransferDest` |

### 4. 行为矩阵（LLM 视角，`AGENTS.md` 及其大小写变体）

| 操作 | 改前 | 改后 |
|---|---|---|
| read（read/list/search、copy source） | ✓ | ✓ |
| `write_file`（含新建）/ `edit_file`（仅既有文件） | ✗（大小写不敏感平台可经 `agents.md` 绕过） | **✓** |
| copy 普通文件 → `AGENTS.md` | ✗（dest write 拒） | ✗（transfer dest 拒） |
| move 普通文件 → `AGENTS.md` | ✗ | ✗ |
| copy `AGENTS.md` → userFiles | ✓ | ✓（非破坏性，读语义不变） |
| move `AGENTS.md` → userFiles | ✓（缺口，且可经 `agents.md` 绕过） | **✗（收紧，大小写变体同拒）** |
| server（UI）读/写/删 | ✓ | ✓（SRV 集合不变，PM 接线不变） |

### 5. 载入行为（不新增 feature）

- `AGENTS.md` 在会话装配时读入 system prompt（`session/agent-assembly.ts:181-183`）；仅 agent profile 更新触发的 reload 会重读（`session-manager.ts:22-27` → `markReloadPending`）
- Agent 编辑后：文件树经 fs-watcher `rootIndex` watch（`server/src/bus/fs-watcher.ts`）广播刷新——既有机制；当前会话 system prompt 不热更新，新会话或下次 reload 生效，与用户在 UI 编辑的行为完全一致
- 不引入 `AGENTS.md` 变更触发的 prompt 热重载

### 6. 不做的事

- 不放开 changelog / projectConfig / `.spherse` 敏感元数据等其他类别的 LLM 写（矩阵测试钉住不回归）
- 不动 `run_command`（逐次审批是唯一硬屏障，保持）；Agent 编辑 `AGENTS.md` 的合法路径 = 文件工具 + access policy，不是 shell 绕过
- 不扩展 deniedPaths 覆盖 `rootIndex`（保留路径校验与前端提示机制不变；随大小写不敏感匹配，`agents.md` 变体现在也归入保留路径——`isReservedDenyPath` 依赖 `categorizePath`，行为更一致，有测试钉住）
- 不新增 LLM delete 工具；server 侧删除行为不变
- 不整体修改 move source 语义（如「source 必须 ∈ LLM_WRITE」）——那会改变 attachments 等类别的既有行为，超出本次范围

## 已知边界（本轮显式接受，存量问题）

- **大小写匹配的平台性缺口（除 rootIndex 外）**：`changelog`、`.spherse` 系列等模式仍大小写敏感，在不敏感文件系统上可用大小写变体落入 `userFiles` 绕过保护（如 `.SPHERSE/project.yaml`）。存量问题、影响全部类别，与本次改动无关；rootIndex 因本次收紧需要闭环而单独处理。沉淀 backlog 待决策
- **move source 收紧仅覆盖 rootIndex**：`LLM_READ` 中其余 16 类（changelog、projectConfig、attachments、spherseOther 等）今天即可被 move 搬走，本次不改变；目录级 move 更可在一次 rename 中搬走 `agentSessions` / `agentMcp` 等 LLM 读都被拒的子树（如 source=`.spherse/agents` ∈ `agentsRoot` 可读）。存量缺口，沉淀 backlog 待整体决策
- **pathRule × move source 裁决从 read 变 write**：有意收紧（搬走是写类操作），当前无 production 注册方；用测试钉住语义

## 测试

- `path-category.test.ts`：`agents.md` / `Agents.md` 变体 → `rootIndex`；`AGENTS.md.bak` 等形近路径仍不误判；其他类别大小写敏感行为不变（如 `.SPHERSE/project.yaml` 仍为 userFiles，钉住存量现状）
- `access-policy.test.ts`：MATRIX `rootIndex` 行 `llmWrite` 翻 true；「throwing vs non-throwing」中原 `AGENTS.md` 拒绝用例换 `CHANGELOG.md`；新增 transferDest / moveSource 矩阵（`rootIndex` 拒、userFiles 允、attachments move source 允、`agentSessions` 拒等）与 deniedPaths 对新 kind 的阻断用例；server 端新 kind 与 `SRV_WRITE` 等值的钉住用例
- 工具级（现有风格补用例）：`write-file` 新建/覆写 `AGENTS.md` 成功、`edit-file` 编辑既有 `AGENTS.md` 成功（正向）；`copy-file` dest=`AGENTS.md` 拒、source=`AGENTS.md` 成功；`move-file` source=`AGENTS.md` 拒（含 `agents.md` 变体）、dest=`AGENTS.md` 拒
- `path-rules.test.ts`：补 pathRule × transferDest / moveSource 裁决用例（取 `rule.llm.write`）
- 非回归：其余类别矩阵行不变；`denied-paths.test.ts`（`rootIndex` 仍保留）照跑
- server / app / desktop 无行为与契约变更，无新增契约测试（PM `copyFileWithin` 行为不变）

## 文档同步

- `docs/official/architecture/security.md`：LLM write 白名单（6→7 类）+ 访问策略节补 transferDest / moveSource 语义与 pathRule 裁决规则 + 已知边界补两条存量缺口（大小写平台性、move source 仅 rootIndex 收紧）
- `docs/official/project-structure.md`：`access-policy` 行内描述同步
- `docs/dev/backlog.md`：新增「路径保护存量缺口」条目（大小写匹配平台性 + move source 语义整体化）
- `packages/presets/skills/spherse-guide/SKILL.md`：项目节补一句「具备文件写入工具的 Agent 可编辑 `AGENTS.md`」
- i18n：无新增用户可见文案（拒绝消息面向 LLM，为英文工具结果文本）

## 验证

`npm test --workspace=packages/core`、`npm run lint`、`npm run build` + `npm run typecheck`（全仓 typecheck 依赖 dist）；无 UI/E2E 影响面，不跑 E2E 全量
