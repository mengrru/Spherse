# 提取 TreeRow 共享样式组件

## 目标

从 file tree 和 agent session list 中提取共用的行样式为 `TreeRow` 纯样式组件，供现有模块和未来新增的 side panel 模块复用。

## 组件设计

### `TreeRow`

位置：`packages/app/src/components/ui/tree-row.tsx`

一个纯样式壳组件，封装侧边栏树形列表行的通用样式。不涉及折叠逻辑、菜单、编辑等交互——这些由调用方自行组合。

#### Props

```ts
interface TreeRowProps extends ButtonProps {
  depth: number;       // 缩进层级，映射到 paddingLeft: depth * 16 + 8
  selected?: boolean;  // 选中态
}
```

#### 样式规则

- 渲染 `Button variant="ghost" size="default"` 作为基元
- 基础 className：`w-full justify-start gap-2`
- 未选中：`text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground`
- 选中：`bg-sidebar-accent text-sidebar-accent-foreground font-medium`
- 缩进：`style={{ paddingLeft: depth * 16 + 8 }}`
- 调用方可通过 `className` prop 扩展或覆盖（如添加 `group` class）
- 其余 Button props（onClick、render 等）透传

#### 使用示例

File tree 文件行：
```tsx
<TreeRow depth={depth} selected={isSelected} onClick={() => onToggle(node)}>
  <FileIcon className="size-4 shrink-0 text-sidebar-foreground/70" />
  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>
</TreeRow>
```

Agent session 行：
```tsx
<TreeRow depth={1} selected={active} onClick={() => onSelect(session)}>
  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{title}</span>
</TreeRow>
```

Agent group 行（可折叠）：
```tsx
<CollapsibleTrigger render={<TreeRow depth={0} className="group pr-8" />}>
  <ChevronRightIcon className="size-4 shrink-0 text-sidebar-foreground/70 transition-transform group-data-[panel-open]:rotate-90" />
  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>
</CollapsibleTrigger>
```

## 不抽取的部分

| 元素 | 理由 |
|---|---|
| `Collapsible` / `CollapsibleContent` | 各模块折叠交互差异大（Trigger render prop vs onClick 控制），不值得抽象 |
| 文本截断 span（`overflow-hidden text-ellipsis whitespace-nowrap`） | 仅 3 个 Tailwind class，不值得单独组件 |
| 子容器 `div.flex.flex-col.gap-px` | 同上 |

## 改动范围

1. **新增** `packages/app/src/components/ui/tree-row.tsx` — TreeRow 组件
2. **修改** `packages/app/src/features/file-tree/FileTreeNode.tsx` — 行 Button 替换为 TreeRow
3. **修改** `packages/app/src/features/agent-session-list/AgentRow.tsx` — 行 Button 替换为 TreeRow
4. **修改** `packages/app/src/features/agent-session-list/SessionRow.tsx` — 行 Button 替换为 TreeRow

## 验证方式

1. 视觉检查：agent list 和 file tree 行样式与改动前完全一致
2. 功能检查：点击、选中、折叠、菜单等交互均正常
3. `npm run lint` 通过
4. `npm test --workspace=packages/app` 通过
