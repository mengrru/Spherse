# 文档浏览划选后支持 Ctrl/Cmd+C 复制

- 日期：2026-08-29
- 状态：已实施（lint、typecheck、E2E 通过）
- 类型：bugfix（交互行为）
- 影响范围：`packages/app`（`text-selection-session` feature，仅 Electron 生效）

## 1. 问题

用户反馈：在 content browser 浏览文档时划选文本后，习惯性按 Ctrl/Cmd+C 无法复制，只能点浮动工具栏的复制按钮，反直觉。

## 2. 根因分析

没有任何快捷键拦截。`useTextSelection.ts` 在 `mouseup` 时把选区快照进 React state 后调用 `selection.removeAllRanges()` 主动销毁原生选区（2026-06-02 bugfix 引入：为让「发起会话」弹窗打开、焦点进入输入框后高亮不消失，用 `SelectionHighlightOverlay` 替代原生高亮）。副作用是按键时原生复制已无可复制内容，Ctrl/Cmd+C 变成 no-op，浮动按钮成了唯一复制路径。

## 3. 方案

保留既有「快照 + 自绘高亮」设计，在快照存活期间补回键盘复制路径：

- `useTextSelection` 新增 keydown effect：`selectionState` 存在时监听 Ctrl/Cmd+C（排除 Alt 组合），`preventDefault()` 后 `navigator.clipboard.writeText(selectionState.text)`，成功后清除选区状态，与工具栏复制按钮行为一致
- 焦点在可编辑元素内（input/textarea/contentEditable，如弹窗补充说明输入框）时不拦截，保证编辑场景的原生复制不受影响

## 4. 测试

- `packages/desktop/e2e/text-selection-session.spec.ts` 新增用例：划选后原生选区已 collapse 的前提下按 Ctrl/Cmd+C，通过主进程 `clipboard.readText()` 断言剪贴板内容为选中文本，且工具栏与高亮 overlay 随之清除
