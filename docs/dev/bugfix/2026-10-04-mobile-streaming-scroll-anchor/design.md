# 移动端流式输出时上划被逐行顶走（WebKit 无 scroll anchoring）

## 现象

移动端（web PWA）流式输出期间用户向上滚动后，视口内容随流式 token 逐行被顶上去，无法稳定阅读历史；桌面端同样操作视口稳定。

## 定位链

1. 聊天滚动容器是 `flex flex-col-reverse`（`MessageList.tsx`），DOM newest→oldest，`scrollTop = 0` 即底部；流式 token 到达时末条消息在视觉底部增长，历史内容整体上移（`useChatScroll.ts` 流式帧无任何 JS 滚动介入，原生贴底只覆盖 `scrollTop === 0` 的情形）。
2. 桌面（Electron/Chromium）与移动端（iOS 上一切浏览器/PWA = WebKit）共用同一份滚动代码，行为差异只能来自引擎：Chromium 默认启用 CSS scroll anchoring（`overflow-anchor`），布局变化时自动调整 `scrollTop` 保持锚定元素视觉稳定——这就是桌面端"稳定显示"的真正来源，而非 column-reverse 本身。
3. WebKit 至今未实现 scroll anchoring（`CSS.supports('overflow-anchor', 'auto')` 为 false），`scrollTop < 0` 时底部每增长 Δ 像素，视口内容就被顶走 Δ 像素——逐行被顶。

## 根因

非贴底位置的滚动稳定性隐式依赖 Blink 独有的 scroll anchoring，未做跨引擎的自管锚定。

## 修复

自管锚定补偿，跨浏览器行为一致（`useChatScroll.ts` + `MessageList.tsx`）：

1. 容器显式 `[overflow-anchor:none]`：禁用 Blink 原生锚定，避免与 JS 补偿双重补偿，所有引擎行为统一。
2. 流式帧补偿：entries 变化的 `useLayoutEffect` 中计算 `heightDelta = scrollHeight - prevScrollHeight`；非贴底（`scrollTop < 0`）、非程序化滚动、非 load-more 恢复路径时 `scrollTop -= heightDelta`——column-reverse 语义下底部增长 Δ，历史内容距底距离 +Δ，`scrollTop` 同步 -Δ 即视口锁定原内容。
3. 程序化滚动保护：`scrollToBottom("smooth")` 期间置 programmatic 标志（到位 `scrollTop === 0` 或超时清除），补偿写 `scrollTop` 会取消进行中的 smooth 动画，必须跳过。
4. 贴底（`scrollTop === 0`）不补偿，保留原生跟随；load-more 恢复路径与首挂载恢复路径不参与补偿，基准 `prevScrollHeight` 在所有分支统一推进。

已知取舍：按 `scrollHeight` 总增量补偿，视口上方高度变化（历史图片加载等）理论上引入过度补偿，属边缘场景；流式帧补偿写 `scrollTop` 会打断 iOS 惯性滚动，表现为滑不远，业界 column-reverse 方案同样取舍；`scrollToBottom("smooth")` 被手势打断后至多 700ms 内（programmatic 黑窗）的流式位移不回补。

## Review 修复（commit 2）

- thinking indicator 出现帧（非 entries 驱动的底部增长，重连/trigger 场景）纳入锚定补偿：`useChatScroll` 增加 `thinking` 参数，独立 `useLayoutEffect` 复用同一补偿函数（基准推进与 entries effect 声明顺序保证同帧不双补）
- sessionId 切换重置 effect 补齐新增 refs（`prevScrollHeightRef` / programmatic 标志与 timer），防御未来调用点漏 key 的跨会话脏基准
- unmount cleanup 去掉 `container` 守卫：全新 session（首帧 loading 无容器）此前不注册 cleanup，`scrollPosition` 不保存（pre-existing），现无条件注册并顺带清 programmatic timer

## 测试

`packages/app/src/features/chat/hooks/useChatScroll.test.ts`：

- `computeAnchorAdjustment` 纯函数：贴底不调、上划返回 `-delta`、programmatic 期间不调、delta 收缩时为正
- hook 集成（renderHook + mock container，参照 `useLocateMessage.test.tsx`）：上划后流式帧 `scrollTop` 补偿到位；贴底时不补偿保持跟随；smooth 到位清标志后再次上划补偿恢复；thinking indicator 增长无 entries 帧也补偿；load-more 恢复不被补偿干扰；用户发送消息走 `scrollToBottom("smooth")` 且当帧不补偿
