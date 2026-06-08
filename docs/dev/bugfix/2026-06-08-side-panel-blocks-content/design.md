# [Bugfix] Side panel 收起后 content browser 左侧区域不可操作

## 问题描述

Side panel 取消 pin 自动收起后，content browser 左侧约 260px 区域无法点击、滚动、选择文字。原因是该区域被一个不可见的 DOM 元素覆盖，拦截了所有 pointer events。

## 根因分析

**位置**: `packages/app/src/features/project-panel/index.tsx:44-56`

当 side panel 未 pin 时，ProjectPanel 的布局策略为：

```
外层 div: absolute top-0 left-14 z-30 h-full w-65  ← 固定在原地，占据 56~316px
  └─ 内层 div: -translate-x-[calc(100%+3.5rem)]   ← 内容滑出屏幕
       └─ <aside> 实际面板内容
```

内层通过 CSS `translate` 将内容滑出可视区域，但**外层 div 仍然是 `absolute` 定位、`z-30`、宽 260px**，占据 `left:56px` 到 `left:316px` 的空间。这个外层 div 形成一个不可见的透明遮罩，阻挡了下方 content browser 的所有鼠标事件。

## 修复方案

### 核心思路

将 translate 行为从内层移到外层，让整个外层 div 一起滑出可视区域，从根本上消除遮罩问题。同时调整 ActivityBar 和 ProjectPanel 在未 pin 状态下的定位策略，使其均为浮动（`absolute`），不占据文档流宽度，避免面板收起时主体内容宽度变化。

### 改动 1：ProjectPanel — translate 移到外层

文件：`packages/app/src/features/project-panel/index.tsx`

**修改前**（未 pin 状态）：

```
外层 div: absolute top-0 left-14 z-30 h-full w-65（无 translate，固定在原地）
  └─ 内层 div: translate 行为 + onMouseEnter/onMouseLeave
```

**修改后**（未 pin 状态）：

```
外层 div: absolute top-0 left-14 z-30 h-full w-65
  可见: translate-x-0
  隐藏: -translate-x-[calc(100%+3.5rem)]（多移一个 ActivityBar 宽度，右边缘到 x=0）
  + onMouseEnter/onMouseLeave
  └─ 内层 div: 仅保留 h-full，无 translate，无 hover 事件
```

使用 `left-14` 而非 `left-0 translate-x-14` 的原因：
- pinned → unpinned 切换时无 transform 变化，不会触发过渡动画（避免面板"回收再弹出"的视觉问题）
- 隐藏时使用 `calc(100%+3.5rem)` 确保完全滑出可视区域（`-translate-x-full` 只移自身宽度，右边缘会停在 x=56px）

### 改动 2：ActivityBar — 未 pin 时浮动定位

文件：`packages/app/src/features/activity-bar/index.tsx`

**修改前**：未 pin 时外层 div 为 `relative w-14` 或 `w-0`，始终在文档流中占据或释放宽度，导致主体内容宽度随面板收起而变化。

**修改后**：未 pin 时外层 div 改为 `absolute top-0 left-0 z-40 w-14`，浮动定位，不占据文档流宽度。显示/隐藏通过 `translate-x-0` / `-translate-x-full` 控制。与 ProjectPanel 采用一致的定位策略。

结构变化（未 pin 状态）：

```
外层 div: absolute top-0 left-0 z-40 h-full w-14
  可见: translate-x-0
  隐藏: -translate-x-full
  + onMouseEnter/onMouseLeave
  └─ 内层 div: 仅保留 h-full，无 translate，无 hover 事件
```

## 影响范围

- `packages/app/src/features/project-panel/index.tsx` — translate 和 hover 行为从内层移到外层
- `packages/app/src/features/activity-bar/index.tsx` — 未 pin 时改为浮动定位，translate 和 hover 行为从内层移到外层
- 不影响 pinned 状态的行为
- 不影响 ActivityBar 的 hover trigger 逻辑（2px 左边缘触发区）
- 不影响 text-selection-session 功能

## 验证方式

1. Side panel 取消 pin 后，确认 content browser 左侧区域可正常点击、滚动、选择文字
2. 从左侧边缘 hover 触发 side panel 显示，确认面板正常滑出到 ActivityBar 右侧，无间隙
3. 鼠标移开面板后确认正常收起（120ms 延迟），无残留间隙
4. 点击 unpin 按钮时，确认面板无"回收再弹出"的过渡动画
5. 未 pin 状态下，确认面板收起时主体内容宽度不变化
6. Side panel pinned 状态确认行为不变
7. Text selection 功能确认不受影响
