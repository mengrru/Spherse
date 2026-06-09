# [Bugfix] 侧边栏悬浮操作后卡住不能自动收回

## 问题描述

Side panel 未 pin 时，hover 展开后执行操作（如编辑 agent、打开右键菜单、打开 AI denylist 对话框），操作完成后侧边栏**卡住不收回**。鼠标已在侧边栏外部，但 `onMouseLeave` 未触发（鼠标从 dialog overlay 直接离开，未经过 sidebar 的离开边界），必须将鼠标重新移入 sidebar 再移出才能收回。

## 根因分析

**触发链路**：

1. 用户 hover 展开侧边栏（`sidePanelHovered = true`）
2. 用户点击"编辑 agent" → `<AgentDialog>` 通过 `<DialogPortal>` 在 document root 渲染全屏 overlay
3. 此时鼠标仍在 sidebar DOM 区域内（位置未变），`onMouseLeave` **未触发** — 因为 `mouseenter/mouseleave` 基于鼠标物理位置与元素边界的几何关系，不依赖哪个元素捕获事件
4. 用户在 dialog 上操作，鼠标移至 sidebar 边界外，但由于 dialog overlay 遮挡了 sidebar，浏览器不认为鼠标"进入"了 sidebar，后续的移动也不会触发 `onMouseLeave`
5. 用户关闭 dialog → 鼠标在 sidebar 边界外，`sidePanelHovered` 仍为 `true`
6. 侧边栏保持可见，`onMouseLeave` 无法补触发（鼠标已在边界外，需要先"进入"再"离开"才能触发）

**关键代码位置**：

- `packages/app/src/stores/app-store.ts:214-221` — `hideSidePanel()` 使用 120ms debounce timer
- `packages/app/src/features/project-panel/index.tsx:54` — `onMouseLeave: hideSidePanel`
- `packages/app/src/features/activity-bar/index.tsx:64` — `onMouseLeave: hideSidePanel`

## 修复方案

保留现有 `onMouseLeave` 自动收回机制不变，额外增加点击主内容空白区域收回的方式。当侧边栏卡在 hover 状态时，用户点击主内容区即可收回。

### 改动：添加 click-away

文件：`packages/app/src/layouts/ProjectLayout.tsx`

在 `<main>` 元素上，当 `sidePanelHovered && !sidePanelPinned` 时添加 `onClick` 调用 `hideSidePanel()`。click 事件会冒泡，用户点击主内容区的交互元素时先触发元素自身行为，再冒泡到 `<main>` 收起侧边栏，两者互不冲突。

```tsx
<main
  className="flex-1 overflow-hidden flex flex-col"
  {...(sidePanelHovered && !sidePanelPinned && { onClick: hideSidePanel })}
>
```

需要从 `useAppStore` 引入 `sidePanelHovered`、`sidePanelPinned`、`hideSidePanel`。

## 行为变化

| 场景 | 修改前 | 修改后 |
|------|--------|--------|
| Hover 展开后鼠标移开 | 120ms 后自动收回 | 不变（120ms 后自动收回） |
| 操作后侧边栏卡住 | 必须移入 sidebar 再移出 | 点击主内容空白区域即可收回 |
| Pin 模式 | 不变 | 不变 |
| Hot zone 触发显示 | 不变 | 不变 |

## 影响范围

- `packages/app/src/layouts/ProjectLayout.tsx` — 添加 click-away（唯一改动文件）

## 验证方式

1. Hover 展开侧边栏 → 编辑 agent → 关闭 dialog → 侧边栏卡住可见 → 点击主内容区 → 侧边栏收回
2. Hover 展开侧边栏 → 打开右键菜单 → 关闭 → 点击主内容区 → 侧边栏收回
3. Hover 展开侧边栏 → 打开 AI denylist → 关闭 → 点击主内容区 → 侧边栏收回
4. Hover 展开后鼠标正常移开 → 120ms 自动收回（行为不变）
5. Pin 模式下行为不变
6. 主内容区交互元素（聊天输入框、按钮等）点击时正常工作，同时收起侧边栏
