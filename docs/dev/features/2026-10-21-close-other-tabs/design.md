# 标签栏「关闭其他标签页」设计

- 日期：2026-10-21
- 状态：已实施
- 来源：issue #153 第三项（Refs #153 / #64）

## 背景与目标

内容区标签栏（2026-09-24 content-tabs，决策 #6 当时明确「不做右键菜单」）目前只能逐个点 X 关闭标签。本次引入 tab 右键菜单，首个菜单项为「关闭其他标签页」：

- 保留目标 = 被右键的标签（即便它不是活跃标签）；欢迎页固定保留
- 关闭其余后导航到保留目标
- 遵循现有未保存内容离开守卫，不静默丢编辑
- 仅剩保留目标与欢迎页时菜单项禁用
- 不实现固定三标签、不新增关闭全部 / 右侧关闭等范围
- 关闭标签是纯 UI 语义：不删文件 / 会话，不中止后台任务

## 决策

| 决策点 | 结论 |
|---|---|
| 菜单挂载 | 所有 tab（含欢迎页）包 `TabContextMenu`（新组件，`components/ui/context-menu` 封装 + `display: contents` trigger，不破坏 TabShell flex 布局与既有 data 属性）；菜单唯一项 `tabs.closeOthers` |
| 欢迎页菜单 | 欢迎页也有右键菜单；「关闭其他标签页」在欢迎页上 = 关闭全部内容标签（欢迎页按固定语义永不删除），keepKey 以 `null` 表示 |
| 禁用条件 | 内容标签菜单：`visible.length <= 1`；欢迎页菜单：`visible.length === 0`（Base UI `data-disabled`） |
| 关闭语义（核心） | **非活跃 tab 不渲染（tab = 链接），不可能有脏编辑** → 可直接从 store 删除。活跃 tab 若属「其他」，必须走现有离开守卫导航流 |
| 三分支 | ① keep = 活跃 tab：`store.closeOthers` 直接删其余，无导航（已在保留目标）；② 活跃 tab 属「其他」：先逐个 `store.closeTab` 删非活跃的其他标签，再 `navigate(keepUrl, { replace: true, state: { closeTab: activeKey, closedUrl } })`——被守卫拦截则全部保留，确认后由 `TabRouteBridge` 到达时提交；③ 在欢迎页（无活跃内容 tab）：`store.closeOthers` + `navigate(keepUrl)` |
| 守卫取消不回滚 | 分支②中已直接关闭的非活跃标签不回滚（VSCode 同类行为）；取消后保留目标 + 脏活跃标签并存，无数据丢失 |
| 邻居选择 | 不复用 `pickNeighborKey`（其闭包列表在先删后算的场景会指向已删标签）：导航目标显式取 `tabUrl(keep)` / `projectHomeUrl` |
| nav 栈 | 被直接关闭的标签 URL 立即 `dropFromProjectNavHistory`；活跃标签的 URL 经 `state.closedUrl` 由 bridge 到达后清除（同现有单关流程），防 Back 复活已关标签 |
| store API | 新增 `closeOthers(projectId, keepKey: string | null)`（null = 清空该项目内容标签，欢迎页为虚拟 tab 不入存储）；单次 update + persist，模式同 `closeFileTabs` |
| 复用边界 | `NavState` / `TabRouteBridge` / `useLeaveGuard` 零改动；`closeOtherTabs` 仅由 `TabBar` 内部消费，不进 `features/tabs/index.ts` 导出面 |

## 各层实现

| 文件 | 变更 |
|---|---|
| `packages/app/src/features/tabs/store.ts` | + `closeOthers` |
| `packages/app/src/features/tabs/use-tab-actions.ts` | + `closeOtherTabs(keepKey: string \| null)`（三分支） |
| `packages/app/src/features/tabs/TabContextMenu.tsx` | 新组件（presentational，disabled + onCloseOthers 由 TabBar 传入） |
| `packages/app/src/features/tabs/TabBar.tsx` | WelcomeTab / TargetTab 各包一层 `TabContextMenu` |
| i18n | `tabs.closeOthers`：关闭其他标签页 / 關閉其他分頁 / Close Other Tabs |

## 测试

- `store.test.ts`：closeOthers 保留 / null 清空 / 未知 key 清空 / 无变化不 persist / 持久化
- `TabBar.test.tsx`：非活跃保留目标（导航 + store + nav 栈清理）、活跃保留目标（不导航）、欢迎页菜单（活跃在他处→回欢迎页；已在欢迎页→原地）、禁用态（唯一内容标签 / 欢迎页无标签）
- E2E `content-tabs.spec.ts`：+2 场景——非脏路径（右键 README 关其他 → 保留并导航；右键欢迎页 → 清空）+ 脏路径（取消保留活跃标签与编辑；确认后关闭并跳保留目标）
- 未保存守卫复用：守卫本身有既有单关 E2E 与 `useLeaveGuard` 测试；后台任务不受影响由架构保证（store 关闭不触任何 server 调用），组件测试断言 store 为唯一变更面

## 风险

- `display: contents` trigger：Base UI ContextMenu.Trigger 渲染 div、右键 / 长按事件冒泡定位不受影响；已过组件测试
- 守卫取消后的中间态（保留目标 + 脏活跃标签并存）为有意行为，已在决策表注明
