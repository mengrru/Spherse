# Bugfix: text-selection-session 交互修复

## 问题描述

`text-selection-session` 当前已支持在内容浏览区划取文本并发起新会话，但交互存在三个明显问题：

1. **发起会话按钮的位置和样式不稳定**：按钮直接使用选区末端 range 的 `left/top` 定位，没有根据按钮宽度居中，也没有按视口边界完整 clamp，长文本、多行选区或靠近窗口边缘时容易显得偏移或贴边。
2. **发起会话弹窗宽度不固定**：`StartSessionPopover` 当前设置 `width: "max-content"` 和 `maxWidth: 400`，实际宽度会随文件路径、引用文本和 Agent 名称变化，导致弹窗打开后尺寸跳动。
3. **点击发起会话后选中文本高亮容易消失**：弹窗内 textarea 或按钮获得焦点后，浏览器原生 selection 可能被清空或转移，用户难以确认本次会话引用了哪段文本。

此外，项目当前只有 Vitest 单元测试，没有 E2E 测试基础设施；这类文本选择、浮层定位和焦点行为更适合用 E2E 覆盖。

## 当前实现

相关文件：

- `packages/app/src/features/text-selection-session/hooks/useTextSelection.ts`
- `packages/app/src/features/text-selection-session/StartSessionButton.tsx`
- `packages/app/src/features/text-selection-session/StartSessionPopover.tsx`
- `packages/app/src/features/text-selection-session/index.tsx`
- `packages/app/src/features/content-browser/index.tsx`
- `packages/app/src/layouts/ProjectLayout.tsx`

当前数据流：

```text
ContentBrowser
  -> TextSelectionSession
     -> useTextSelection 捕获 window.getSelection()
     -> StartSessionButton 展示在 selectionState.position
     -> StartSessionPopover 提交 agentId/comment
  -> ProjectLayout.handleStartSession 创建 session 并导航到 chat
```

`useTextSelection` 在 `mouseup` 后读取 `window.getSelection()`，记录选中文本和 collapsed end range 的位置。打开 popover 时通过 `disabled: disabled || showStartPopover` 暂停新的 selection 监听，但没有保存 range，也没有渲染任何独立的视觉高亮。

## 方案对比

### 方案 A：小范围修复定位、固定宽度，并增加视觉选区 overlay（推荐）

在现有 feature 内完成最小改动：

- 将 selection state 从 `{ text, position }` 扩展为 `{ text, position, highlightRects }`。
- `position` 仍由 selection range 计算，但改为基于选区 bounding rect / end rect 的 viewport-aware placement。
- `StartSessionButton` 使用固定尺寸预估或 CSS transform 居中，继续使用现有 shadcn `Button`。
- `StartSessionPopover` 使用固定宽度，例如 `width: 360` 或 `w-[360px]`，并按视口边界 clamp。
- 在 popover 打开期间渲染一个只读的 fixed overlay，根据 selection range 的 client rects 绘制半透明高亮，模拟原生反选状态。
- 点击提交或关闭时清理 selection state 和 overlay。

优点：改动集中、风险低，不改变会话创建数据流；overlay 能解决 textarea 获得焦点后原生 selection 消失的问题。  
缺点：overlay 是视觉保持，不是真正保留浏览器原生 selection；如果内容滚动后不重新计算 rects，高亮位置可能失准，需要监听滚动/resize 或在滚动时关闭/刷新。

### 方案 B：只保存并恢复原生 Range

在点击按钮前保存 `Range`，打开 popover 后调用 `selection.removeAllRanges()` + `selection.addRange(range)` 尝试恢复原生选区。

优点：实现代码少，不需要额外 overlay。  
缺点：浏览器同一时间只能有一个活动 selection；textarea/input 获取焦点后主文档 selection 仍可能被清掉，稳定性差。Electron/Chromium 下对焦点切换敏感，难以 E2E 稳定断言。

### 方案 C：迁移为 Base UI Popover 并重做交互

将按钮和弹窗统一迁移为完整 Popover 组合，由基础组件接管 focus/dismiss/position 行为。

优点：长期更符合 UI 基础组件迁移方向。  
缺点：本 bugfix 会扩大为组件重构；仍不能天然解决原生 selection 被焦点清除的问题，还需要 overlay 或 Range 恢复。

## 推荐方案

采用 **方案 A**。

理由：本任务是 bugfix，应优先用最小范围修复用户可见问题。按钮位置、弹窗宽度和选区视觉保持都可以在 `text-selection-session` feature 内完成，不需要修改后端、store 或会话创建流程。

## 详细设计

### 1. Selection state 扩展

将 `SelectionState` 设计为：

```typescript
interface SelectionState {
  text: string;
  position: { x: number; y: number };
  highlightRects: Array<{ left: number; top: number; width: number; height: number }>;
}
```

`highlightRects` 来自 `range.getClientRects()`，只保留 `width > 0 && height > 0` 的 rect，并转换为 viewport fixed 坐标。这样 overlay 可以直接使用 `position: fixed` 渲染，不依赖文档滚动坐标。

如果 `getClientRects()` 为空，则退回到 `range.getBoundingClientRect()`；如果仍为空，则不显示按钮。

### 2. 按钮定位与样式

按钮继续由 `StartSessionButton` 渲染，但位置计算从“选区末端左上角”改为“靠近选区视觉中心并避开视口边界”。

定位规则：

1. 优先放在选区上方，距离选区顶部约 8px。
2. 如果选区顶部空间不足，则放在选区下方。
3. `x` 使用选区 bounding rect 的水平中心点。
4. `position` 表示按钮视觉中心锚点，`StartSessionButton` 通过 `translateX(-50%)` 居中；计算锚点时仍按按钮预估宽度做边界 clamp，避免居中后溢出。

样式继续使用 `Button variant="secondary" size="sm"`，但增加更明确的浮层视觉：

- `fixed z-50 shadow-lg ring-1 ring-border/60`
- 图标使用固定尺寸，例如 `size-3.5`
- 按钮内容保持“发起会话”

不引入新的设计语言，保持当前 shadcn token 体系。

### 3. 弹窗固定宽度

`StartSessionPopover` 的宽度固定为一个常量，例如：

```typescript
const POPOVER_WIDTH = 360;
```

定位规则：

1. `left` 基于 selection position 水平居中到按钮/选区附近。
2. `left` clamp 到 `[8, window.innerWidth - POPOVER_WIDTH - 8]`。
3. `top` 优先使用按钮下方或选区附近位置，并 clamp 到视口内。
4. `width` 固定为 `POPOVER_WIDTH`，不再使用 `width: "max-content"`。
5. `maxHeight` 仍按 `window.innerHeight - 16` 控制，内部内容可滚动。

这样弹窗在不同文本长度、路径长度和 Agent 名称下保持稳定宽度。

### 4. 选区视觉保持

打开 popover 后，不能依赖浏览器原生 selection 一直可见。设计为增加 `SelectionHighlightOverlay`：

```typescript
interface SelectionHighlightOverlayProps {
  rects: Array<{ left: number; top: number; width: number; height: number }>;
}
```

渲染方式：

- 在 `TextSelectionSession` 中，当 `selectionState` 存在且 `showStartPopover` 为 true 时渲染 overlay。
- overlay 使用 `pointer-events-none fixed z-40`，每个 rect 渲染一个绝对定位 div。
- 颜色使用当前 selection token 的近似值：`bg-primary/25` 或 `bg-primary/20`，不遮挡文字阅读。
- `StartSessionButton` 和 `StartSessionPopover` 保持 `z-50`，覆盖在 overlay 之上。

滚动与 resize 行为：

- 最小实现：在 document/window scroll 或 resize 时关闭当前 selection state，避免 overlay 错位。
- 本 bugfix 不在 scroll/resize 后重算 rects，优先关闭当前 selection，减少状态复杂度。

### 5. Dismiss 与焦点行为

保留当前 `useDismissable` 行为：点击外部或 Escape 关闭按钮/弹窗。

细节要求：

- 点击 `StartSessionButton` 时继续 `preventDefault()`，降低原生 selection 立即丢失的概率。
- 打开 popover 后即使原生 selection 消失，`selectionState.text` 和 `highlightRects` 仍保留，直到提交或关闭。
- 关闭或提交时调用 `clearSelection()`，清理按钮、弹窗和 overlay。
- 不修改 `ProjectLayout.handleStartSession` 的消息格式和导航逻辑。

## E2E 测试基础设施设计

### 目标

为文本划选、浮层定位、弹窗宽度和选区视觉保持增加可自动化回归测试。当前 Vitest 更适合 store/hook 级逻辑，无法可靠覆盖真实 selection、focus 和 Electron 渲染行为。

### 推荐工具

采用 Playwright 的 Electron 支持：

- 新增 dev dependency：`@playwright/test`
- 新增脚本：`npm run test:e2e --workspace=packages/app`
- 新增配置：`packages/app/playwright.config.ts`
- 新增测试目录：`packages/app/e2e/`

### 范围控制

本 bugfix 的实现范围包含最小 E2E infra，只做可用闭环：

1. 能启动 Electron app。
2. 能准备一个临时项目目录和测试文件。
3. 能进入内容浏览页。
4. 能通过 Playwright 鼠标或 DOM selection API 选中文本。
5. 能断言：
   - 发起会话按钮出现在选区附近并不溢出视口。
   - 点击按钮后 popover 宽度固定。
   - popover 打开后存在 selection highlight overlay。

本次不覆盖完整 LLM/WebSocket 会话发送链路，避免 E2E 依赖真实 provider 或复杂 mock server。会话创建链路继续由现有 store/API 层测试或后续专项 E2E 扩展覆盖。

### 测试稳定性要求

- 为按钮、popover、overlay 增加稳定 selector，例如 `data-testid="text-selection-start-button"`、`data-testid="text-selection-popover"`、`data-testid="text-selection-highlight"`。
- 测试中固定窗口大小，避免定位断言受响应式布局影响。
- 宽度断言允许 1px 误差，避免浏览器缩放和子像素差异。

## 验证计划

### 手动验证

1. 在 Markdown 文件中选中单行文本，确认按钮位于选区上方居中，点击后弹窗宽度稳定。
2. 在 Markdown 文件中选中多行文本，确认按钮不偏离选区，overlay 覆盖所有选中行。
3. 在靠近视口左/右/顶部/底部的位置选中文本，确认按钮和弹窗不溢出视口。
4. 点击按钮后 textarea 自动可用，选区视觉高亮仍可见。
5. 点击外部、按 Escape、提交 Agent 后，按钮、弹窗和 overlay 均消失。
6. 编辑模式下不出现文本划选会话入口。

### 自动化验证

1. `npm test --workspace=packages/app`
2. `npm run build --workspace=packages/app`
3. `npm run test:e2e --workspace=packages/app`

## 文件变更范围

### 预计修改

- `packages/app/src/features/text-selection-session/hooks/useTextSelection.ts`
- `packages/app/src/features/text-selection-session/StartSessionButton.tsx`
- `packages/app/src/features/text-selection-session/StartSessionPopover.tsx`
- `packages/app/src/features/text-selection-session/index.tsx`

### 预计新增

- `packages/app/src/features/text-selection-session/SelectionHighlightOverlay.tsx`
- `packages/app/playwright.config.ts`
- `packages/app/e2e/text-selection-session.spec.ts`
- `packages/app/e2e/helpers/electron.ts`

### 预计配置变更

- `packages/app/package.json` 增加 `test:e2e` script 和 `@playwright/test` dev dependency

## 非目标

- 不改变会话消息格式。
- 不改变 Agent 选择与 session 创建流程。
- 不支持 HTML iframe preview 内部文本选择。
- 不将本 bugfix 扩大为全量 Popover 组件迁移。
- 不在本次设计中要求 mock LLM provider 或完整聊天链路 E2E。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| overlay 与真实 selection 颜色存在差异 | 使用 `bg-primary/20` 保持轻量视觉提示，不追求完全等同原生 selection |
| 滚动后 overlay 坐标失准 | scroll/resize 时关闭 selection，后续如有需要再实现 Range 重算 |
| 固定宽度在窄窗口下仍可能过宽 | clamp 时使用 `Math.min(POPOVER_WIDTH, window.innerWidth - 16)` |
| E2E infra 引入成本高 | 先做最小 Electron 启动和单个回归 spec，不覆盖完整业务链路 |

## 成功标准

- 划选文本后，“发起会话”按钮位置稳定，视觉上贴近选区且不溢出视口。
- 点击按钮后弹窗宽度固定，不随内容长度跳动。
- 弹窗打开期间，用户仍能看到被引用文本的视觉高亮。
- 现有创建会话行为保持不变。
- 有明确的 E2E infra 方案，并纳入本 bugfix 的最小回归覆盖范围。
