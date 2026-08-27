# 移动端 chat 输入框回车改为换行

- 日期：2026-08-28
- 状态：已实施（测试、lint、typecheck 通过）
- 类型：bugfix（交互行为）
- 影响范围：`packages/app`（chat/floating chat 共用的 `Composer`）、`packages/web` PWA（被动受益）

## 1. 问题

移动端（packages/web PWA）chat 输入框中，软键盘的回车键触发发送。移动端软键盘没有 Shift 键，桌面端的「Enter 发送 / Shift+Enter 换行」约定在移动端退化为「无法换行」——用户只能粘贴才能输入多行文本，与 #1（多行列表输入）直接相关。

## 2. 根因分析

`Composer.tsx` 的 `onKeyDown` 对 Enter（无 Shift、非 IME composing）一律 `preventDefault()` + `send()`，未区分输入设备；软键盘回车与物理键盘回车行为相同。此外未设置 `enterKeyHint`，各平台键盘键帽提示随缘。

## 3. 方案

- 新增 `useIsCoarsePointer()` hook（`packages/app/src/hooks/use-coarse-pointer.ts`）：监听 `(pointer: coarse)` 媒体查询，识别「主输入指针为触摸」的设备（手机/平板软键盘场景）
- 触摸设备上不再拦截 Enter：回车走 textarea 默认行为插入 `\n`，发送一律走发送按钮；桌面（fine pointer，Electron/桌面浏览器）维持 Enter 发送不变
- `enterKeyHint` 按设备返回 `"enter"`（触摸，键帽显示换行）/ `"send"`（桌面，物理键盘忽略此属性）

选择 `pointer: coarse` 而非视口宽度（`useIsMobile`）：Enter 行为应随「输入形态（虚拟键盘 vs 物理键盘）」而非窗口尺寸切换，桌面端窄窗口不应改变回车语义。已知取舍：iPad 外接键盘时主指针仍为触摸，回车为换行（与 WhatsApp 等一致，发送按钮始终可用）。

## 4. 测试

- `Composer.test.tsx` 新增：fine pointer 时 Enter 发送且 `enterkeyhint="send"`；coarse pointer 时 Enter 不发送、不改动输入内容且 `enterkeyhint="enter"`；触摸设备发送按钮仍可发送
- `vitest.setup.ts` 补 jsdom 缺失的 `window.matchMedia` stub（可用 spyOn 覆盖），既有用例不受影响
