# [fix] 统一 Agent List 和 File Tree 样式（以 File Tree 为准）

## 问题

Agent session list 和 file tree 两个侧边栏组件视觉风格不一致：

| 方面 | Agent Session List | File Tree |
|---|---|---|
| 组件基元 | shadcn sidebar 系列 (`SidebarMenuButton`, `SidebarMenuSubButton`, `SidebarMenuSub`) | 纯 `Button variant="ghost"` + `Collapsible` |
| 子项缩进 | `SidebarMenuSub` 的 `mx-3.5 border-l border-sidebar-border`（左侧竖线 + 偏移） | `paddingLeft: depth * 16 + 8`（纯缩进，无竖线） |
| 展开箭头动画 | 手动 toggle `rotate-90` class | `transition-transform group-data-[panel-open]:rotate-90` CSS 驱动 |
| 文本溢出 | `[&>span:last-child]:truncate`（sidebar variant 继承） | 显式 `overflow-hidden text-ellipsis whitespace-nowrap` |

## 方案

以 file tree 为基准，将 agent list 从 sidebar primitives 改为 `Button` + `Collapsible` 模式。

**选择理由**：相比在 sidebar primitives 上覆盖样式（需对抗内置样式），直接使用与 file tree 相同的组件模式更简洁、可维护性更好，且不影响功能逻辑。

## 改动范围

### `AgentSessionListView.tsx`

- `SidebarMenu` → `<div className="flex flex-col gap-px text-xs">`
- 移除 `sidebar` import

### `AgentGroup.tsx`

- 用 `Collapsible` 包裹整个组件：
  - `open={!collapsed}`，`onOpenChange` 触发 `onToggleCollapsed`
  - `AgentRow`（现在是 `Button`）通过 `CollapsibleTrigger` render prop 渲染
  - session 列表放在 `CollapsibleContent className="ml-2"` → `<div className="flex flex-col gap-px">` 内
- 移除 `SidebarMenuItem`、`SidebarMenuSub`
- 新增 `Collapsible`、`CollapsibleTrigger`、`CollapsibleContent` import

### `AgentRow.tsx`

- `SidebarMenuButton size="sm"` → `Button variant="ghost" size="default"`
- className 与 file tree 目录行一致：`w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground`
- Chevron 图标：`size-4 shrink-0 text-sidebar-foreground/70 transition-transform`，展开时加 `rotate-90`
- 文本：`<span className="overflow-hidden text-ellipsis whitespace-nowrap">`
- `SidebarMenuAction` → 绝对定位的 `Button variant="ghost" size="icon"` 作为 dropdown trigger，保留 hover 显隐行为（`opacity-0 group-hover/agent-row:opacity-100`）
- 移除 `SidebarMenuButton`、`SidebarMenuAction` import

### `SessionRow.tsx`

- `SidebarMenuSubItem` → `<div>`
- `SidebarMenuSubButton isActive={active}` → `Button variant="ghost"`，通过条件 className 处理选中态：
  - 选中：`bg-sidebar-accent text-sidebar-accent-foreground font-medium`
  - 未选中：`text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground`
- 缩进：`style={{ paddingLeft: 24 }}`（depth=1, `1 * 16 + 8 = 24px`，与 file tree 一致）
- 移除 `SidebarMenuSubButton`、`SidebarMenuSubItem` import

### 不改动的文件

- `index.tsx`（顶层容器、Dialog 逻辑不变）
- `EmptyAgents.tsx`
- `hooks/useGroupedSessions.ts`
- File tree 所有组件
- 功能逻辑（DropdownMenu、ContextMenu、inline rename）全部保留

## 验证方式

1. 视觉检查：agent list 和 file tree 的行高、间距、缩进、hover、选中态、展开动画应一致
2. 功能检查：agent 展开/折叠、session 选中、右键菜单、三点菜单、inline rename 均正常
3. `npm run lint` 通过
4. `npm test --workspace=packages/app` 通过
