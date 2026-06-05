# [Bugfix] Chat 输入框编辑时滚动至顶部

## 问题描述

Chat 输入框（`Composer` 组件）在内容超出可见区域出现滚动条后，用户继续编辑内容时光标位置保持不变，但可视区域会跳动到顶部。

## 复现步骤

1. 打开任意 chat session
2. 在输入框中输入足够多内容，使输入框出现滚动条（超过 10 行，触发 `MID_HEIGHT` 上限）
3. 滚动到底部，继续输入或删除内容
4. 观察到可视区域跳回顶部

## 根因分析

**位置**: `packages/app/src/features/chat/Composer.tsx:27`

`useLayoutEffect` 中的 auto-resize 逻辑在每次 `input` 变化时执行：

```tsx
textarea.style.height = "auto";     // <-- 问题根源
const natural = textarea.scrollHeight;
```

执行流程：

1. 用户输入 → `onChange` → `setInput()` 触发重渲染
2. `useLayoutEffect` 依赖 `[input, manualExpanded]` 变化，同步执行
3. `textarea.style.height = "auto"` 瞬间折叠 textarea，内容不再溢出
4. 浏览器将 `scrollTop` 重置为 0
5. 后续代码恢复正确高度，但 `scrollTop` 已丢失

**触发条件**: 仅当内容超出 `MID_HEIGHT`（10 行）且未手动展开时出现滚动条，`height = "auto"` 才会导致内容高度低于 textarea 高度，从而丢失滚动位置。

**次要问题**: 基础 `Textarea` 组件（`textarea.tsx`）使用 `field-sizing-content` CSS 属性，与 Composer 的手动高度管理存在潜在冲突。当前通过 inline style 覆盖，功能不受影响，但增加理解成本。

## 修复方案

**选择方案: 保存/恢复 scrollTop**

在 `useLayoutEffect` 中，resize 前保存 `scrollTop`，resize 后恢复：

```tsx
useLayoutEffect(() => {
  const textarea = textareaRef.current;
  if (!textarea) return;

  const prevScrollTop = textarea.scrollTop;

  textarea.style.height = "auto";
  const natural = textarea.scrollHeight;
  const exceeds = natural > MIN_HEIGHT + 4;
  setContentExceeds3Lines(exceeds);
  if (!exceeds && manualExpanded) {
    setManualExpanded(false);
    return;
  }
  if (manualExpanded) {
    textarea.style.height = `${MAX_HEIGHT}px`;
    textarea.style.overflowY = natural > MAX_HEIGHT ? "auto" : "hidden";
  } else {
    const targetHeight = Math.max(MIN_HEIGHT, Math.min(natural, MID_HEIGHT));
    textarea.style.height = `${targetHeight}px`;
    textarea.style.overflowY = natural > MID_HEIGHT ? "auto" : "hidden";
  }

  textarea.scrollTop = prevScrollTop;
}, [input, manualExpanded]);
```

**改动量**: 2 行（保存 + 恢复 scrollTop）

### 方案对比

| 方案 | 改动量 | 风险 | 说明 |
|------|--------|------|------|
| **A. 保存/恢复 scrollTop** (选择) | 2 行 | 低 | 最简单，直接解决根因 |
| B. 影子元素测量 | ~15 行 | 中 | 用隐藏 div 测量自然高度，避免 textarea 抖动。过度工程 |
| C. CSS field-sizing 替代 | ~30 行 | 高 | 移除手动 resize 逻辑，依赖浏览器原生 `field-sizing-content`。浏览器兼容性不确定，行为差异大 |

选择方案 A 理由：根因明确，改动最小，风险最低，YAGNI。

## 影响范围

- `packages/app/src/features/chat/Composer.tsx` — 唯一修改文件
- 不影响 `MessageList` 滚动行为
- 不影响输入框的 auto-resize 逻辑和展开/收起功能
- 不影响基础 `Textarea` 组件

## 验证方式

1. 输入超过 10 行内容，确认出现滚动条
2. 滚动到底部，继续输入 — 确认可视区域不再跳动
3. 滚动到中间位置，删除内容 — 确认滚动位置保持
4. 手动展开后输入/删除 — 确认功能正常
5. 少于 3 行内容 — 确认收起功能正常
