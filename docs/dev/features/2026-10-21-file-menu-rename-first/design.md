# 文件菜单重命名优先

## 背景

Issue #153 第一项：文件列表右键菜单的第一项应为「重命名」，放在浮窗之前（重命名使用频次显著高于浮窗），维护者已承诺修改。

现状核验（基线 `origin/dev@678e2b14`）：文件树右键菜单（`FileTreeContextMenu.tsx`）当前**没有**重命名项，整条链路（PM 方法 / contracts schema / server 路由 / api client / UI）均不存在，只有 session rename。因此本任务是「端到端新增重命名能力 + 菜单置首」，而非单纯调序。

## 目标与红线

- 文件与目录的右键菜单第一项均为「重命名」（文件菜单中位于浮窗/分窗之前）；文件/文件夹菜单按各自适用能力保持一致（浮窗/分窗仍仅文件可见）
- 不变更浮窗行为与门控（`isFile && onFloatFile`、feature flag 降级链原样）
- 不变更权限门控与只读限制：readOnly（`capabilities.content.editable=false`）下整个菜单本就不渲染，重命名天然被同一门控覆盖；server 侧 `serverAccessPolicy` 照常兜底，未获得任何放宽
- 尽量最小改动；复用现有模式（create/delete 流、InlineNameInput、SessionRow inline rename）

## 设计

### D1 core：`ProjectManager.renamePath(fromRelative, toRelative)`

对齐 `createEntry`/`deletePath`/`copyFileWithin` 模式：

1. `resolveProjectPath` 解析两端（拒绝穿越）
2. `policy().assertMoveSource(from)` + `policy().assertTransferDest(to)`（与 move-file 工具同组断言；serverAccessPolicy 下同为 SRV_WRITE 集）
3. `fileWriteMutex.run(dest, ...)` 内：
   - 源不存在抛 `NotFoundError`
   - 目标已存在抛 `ConflictError`，**特判同一实体**：`stat(dest)` 与 `stat(src)` 的 `dev/ino` 相同时放行（大小写不敏感文件系统上仅改大小写的重命名 dest 命中的是源自身，必须允许；对齐 upload `dedupeFileName` 把大小写不敏感当一等公民的先例）
   - `fs.rename`（同父目录内原子重命名，不可能 EXDEV）

### D2 contracts：`contentRenameRequest`

`packages/contracts/src/content.ts` 新增 `Type.Object({ to: Type.String() })`（源路径在 URL 上），导出 schema 与 Static 类型。

### D3 server：`PATCH /api/projects/:projectId/content/*`

**不用 `POST /content/rename` 静态路由**：find-my-way 静态段优先于通配，会遮蔽既有 `POST /content/*` 创建路由——根级名为 `rename` 的文件/目录创建将从可用变为 400，违反「其他操作仍可用」红线。改用 **PATCH**：无既有 PATCH 路由零遮蔽，且与 session rename 的 PATCH 先例（`sessions.ts:160`）一致；源路径走 URL 通配、`to` 走 body。错误映射：`AccessDeniedError`→403、`NotFoundError`→404、`ConflictError`→409。

### D4 app：api client + controller + 菜单 + 内联编辑

- `ApiClient.renameContent(from, to)`：PATCH `/content/{from}` body `{ to }`，对齐 `mkdir`/`touchFile` 模式
- `useFileTreeController`：新增 `renaming: TreeItem | null` 状态与 `requestRename`/`cancelRename`/`submitRename(name)`（签名追加 `onRenamed` 回调参数）。`submitRename`：校验非空 + `INVALID_NAME_RE`；名称未变化直接退出编辑不请求；in-flight ref 防重复提交；`to = childPath(parentDirPath(path), name)`；**失败保留编辑态**只 toast（对齐 create 失败行为）；成功后失效新旧两个路径的查询、把 `expandedPaths` 中旧路径前缀重映射到新路径（对齐 delete 的前缀清理逻辑）、源路径在 `.spherse/skills` 下时追加 `invalidateProjectSkillQueries`（skill 列表是独立 queryKey，rename skill 目录后聊天侧 skill 选择器需要刷新）。`renaming` 状态纳入 projectId 切换 reset effect
- `FileTreeContextMenu`：新增 `onRename` prop，重命名项渲染为**第一项**（文件在浮窗/分窗之前，目录在新建之前），文案复用 `common.rename`（三语已有）；Rename 后跟分隔符（目录菜单中不与「新建文件」粘连）；其余项顺序与门控不动
- `InlineNameInput`：新增可选 `defaultValue`（预填当前名 + focus 全选，对齐 SessionRow rename 行为），创建流程行为不变
- `FileTreeNode`：`renaming` 命中当前 item 时，文件行/目录行原位替换为 `InlineNameInput`（readOnly 下菜单不存在，renaming 不可达）
- `FileTree` 新增 `onRenamed?: (from, to) => void` 线程到 controller（对齐 `onDeleted`）

### D5 打开的标签页/分窗处理

重命名会使旧路径失效，对齐 delete 流的既有行为：`user-file-panel` 的 `onRenamed` 关闭旧路径下的文件标签（`useCloseDeletedFileTabs(from)`）与分窗（`useCloseDeletedSplit(from)`）；`skill-panel` 关闭旧路径标签。浮窗与 delete 流一致不做处理（现状删除文件也不清浮窗，本任务不扩大范围）。**已知取舍**：旧路径下标签若有未保存脏内容会随关闭丢弃（`skipLeaveGuard` 强制导航）——与 delete 流同语义，接受该损失，不为此扩大改动面。

### D6 i18n

新增 `file-tree.renameFailed`（重命名失败：{message}）三语同步；菜单文案复用 `common.rename`，无新增。

## 测试

| 层 | 文件 | 覆盖 |
|---|---|---|
| core | `project-manager-write.test.ts` | renamePath 文件/目录、目标冲突 ConflictError、同实体（仅大小写变更）放行、引擎内部路径拒绝、源缺失 NotFoundError |
| server 契约（真 PM + 真路由，AGENTS.md 契约测试红线） | `write-facade-contract.test.ts` | PATCH rename 200（含大小写变更）、404 源缺失、409 目标存在、403 受保护路径；既有 `POST /content/rename`（创建名为 rename 的条目）不受影响 |
| app 菜单 | `FileTreeContextMenu.test.tsx` | 文件菜单顺序（Rename 第一、先于 Float）、目录也有 Rename 且居首、点击回调带 path、无 handler 不渲染、其余项（Float/Split/New File/Upload 等）仍可用 |
| app 控制器 | `useFileTreeController.test.tsx` | submitRename 调用 renameContent 及失效查询、未改名不发请求、失败 toast 且保留编辑态、目录重命名后 expandedPaths 前缀重映射、onRenamed 回调 |

E2E 不新增（最小改动）；现有 file-tree 相关单测与 e2e 场景作为回归。

## 文档同步

- `docs/official/architecture/server.md` content 路由行补「重命名」
- 本目录 design.md + plan.md

## 边界决策（已自行决策，PR 中说明）

1. 重命名后打开中的标签采用「关闭」而非「迁移到新路径」：对齐 delete 既有行为，避免扩大改动面到 tabs store；脏内容随关闭丢弃，接受
2. rename 端点为 `PATCH /content/*`（源在 URL、`to` 在 body）：对齐 session rename 的 PATCH 先例，且避免静态路由遮蔽 `POST /content/*` 创建入口
3. 重命名 skill 目录时追加 skills 查询失效（delete 流无此处理，rename 是 skill 目录的高频操作，一行成本）
4. rename 端点限定**同目录**重命名（跨目录即 move 语义，归 agent 的 move_file 工具）：PM 校验 `dirname(dest) === dirname(src)`，违反抛 `ValidationError`→400；该限制同时使 into-itself 与目标父目录缺失在结构上不可达
5. `fs.rename` 的 `ENOENT` 包装为 `NotFoundError`→404（stat 与 rename 间的 TOCTOU 兜底）
6. 同实体（仅大小写变更）放行在 `dev/ino` 相等之外增加**解析路径大小写不敏感相等**必要条件：FAT/exFAT 等文件系统 `dev/ino` 恒 0，仅凭 inode 判定会把已存在的另一文件误判为同实体，Windows 上会静默覆盖

## Review 反馈处理（design review）

- Important-1 路由遮蔽 → D3 改为 PATCH 通配
- Important-2 大小写变更误报冲突 → D1 增加 dev/ino 同实体放行 + core 测试
- Important-3 契约测试落点 → server 测试移入 `write-facade-contract.test.ts`（真 PM）
- Medium-1 脏标签丢弃 → D5 明示接受
- Medium-2 renaming 未随 projectId 重置 → D4 纳入 reset effect
- Medium-3 skills 查询失效 → D4 采纳
- Minor-1 dest 断言改用 `assertTransferDest`；Minor-3 失败保留编辑态 + in-flight 防抖；Minor-4 补 expandedPaths 重映射与 onRenamed 测试；Minor-5 Rename 后分隔符 → 均已吸收

## Review 反馈处理（code review）

- Important-1 errno 未映射 / 跨目录 move 语义 / into-itself → 边界决策 4、5（同目录限制 + ENOENT 包装），补 core 与契约测试
- Important-2 dev=0/ino=0 文件系统同实体误判 → 边界决策 6（大小写不敏感相等必要条件）
- Medium-3 错误路径测试 → 随 Important-1 补齐（400 cross-dir、/traversal denied/ 断言）
- Minor-4 FileRow renaming 与 readOnly 检查顺序 → 统一 readOnly 在前
- Minor-5 穿越测试裸 toThrow → 断言 /traversal denied/i
- Minor-6 contracts README 要求新增 schema 用例 → 补 `content-contracts.test.ts`
