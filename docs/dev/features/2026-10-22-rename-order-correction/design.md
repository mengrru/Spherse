# 菜单重命名排序纠正

## 背景

Manager 纠正：#153 第一项「文件列表的右键菜单第一项改为重命名」中「文件列表」实际指 **Session 会话列表**，此前 #174 解读为文件树并已 squash 合入 dev（c4912ad1，重命名端到端能力用户允许保留，不回退）。本任务为纠正排序：

1. **Session 右键菜单**（`SessionRow.tsx`）：重命名移到浮窗之前（原顺序：浮窗 → 重命名 → …）
2. **文件树右键菜单**（`FileTreeContextMenu.tsx`）：重命名从首位移到「上传文件」之后（新建/上传分组的末位）；上传项因能力门控不可见时，重命名按自身门控保持可用，不强行显示上传项

## 约束

- 仅排序变更：不新增接口、不改重命名功能/权限/只读门控、不改上传/浮窗动作行为
- 保持逻辑分组与分隔符合理：文件树中重命名归入新建/上传分组末位，后续分隔符不变；Session 菜单中重命名与浮窗同组（浮窗仍受 `floating-chat` feature 门控，web 宿主下重命名仍居首可用）

## 变更

- `packages/app/src/features/agent-session-list/SessionRow.tsx`：菜单项 JSX 顺序 rename ↔ float 交换
- `packages/app/src/components/file-tree/FileTreeContextMenu.tsx`：删除首位 rename 块（含其后分隔符），在 upload 条件项之后渲染 rename

## 测试

- `FileTreeContextMenu.test.tsx`：顺序断言改为完整菜单序（file：Float → New File → New Folder → Upload Files → Rename → Copy Path → Delete；dir：New File → New Folder → [Upload Files] → Rename → …）；上传门控不可见时 Rename 仍在；无 handler 不渲染；Float/Delete 动作仍可用
- `SessionRow.test.tsx`（新增）：electron 宿主顺序 Rename → Float → …；已浮窗时 Cancel Float 居次；web 宿主（浮窗门控关）Rename 居首；Rename 进入内联编辑、Float 动作回调
