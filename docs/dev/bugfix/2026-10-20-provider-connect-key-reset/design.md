# 修复：已有一个供应商 key 时，为其它供应商填 key 点「连接」被 reset

- 日期：2026-10-20
- 状态：已实施（lint、typecheck、app settings 单测通过）
- 类型：bugfix（前端状态竞态）
- 影响范围：`packages/app`（settings 表单 hook 与 provider 行组件）

## 1. 问题

用户反馈：已存在某模型供应商 API key 时，为另一个供应商填写 API key 后点「连接」按钮，输入框被清空、该供应商仍显示未连接（key 被 reset）。触屏/无 blur 场景下 connect 也不保存 key。

## 2. 根因分析

三个相互叠加的缺陷，主路径是「点击中途按钮翻转」竞态：

**主因：blur commit 在 mousedown 与 click 之间翻转按钮。** 输入框 `onBlur` 即 `commitApiKey` 保存（`ModelProviderItem.tsx`）。点「连接」的完整时序：

1. `mousedown` → 输入框 blur → `commitApiKey` 发出 PUT#1（含 B 的 key）
2. localhost 下 PUT#1 响应在 `mouseup`/`click` 之前返回 → `applyResponse` 置 `configured[B]=true` → 按钮从「连接」翻转为「已连接(断开)」
3. 用户 click 落在翻转后的按钮上 → 触发 `disconnect` → 发出 `{B: {apiKey: ""}}` → 服务端删除刚保存的 key → 输入框清空、B 未连接，表现为「reset」

**次因：`connect` 不显式提交 key。** 原 `connect(id)` 只做 `save()`，payload 完全依赖 blur 已把 key 写进 `writes`；blur 时序异常（触屏、自动填充）时发出空写 PUT，key 不落库。

**伴生：`applyResponse` 清空整组未提交输入。** 任何在途 save 返回都会把两组 `apiKeys` 全部清掉；用户正在为另一个 provider 输入的 key 会被无关 save 的响应抹掉。

服务端 `mergeProviderKeys` 本身是正确 merge 语义（缺省=不变、空串=清除），无需改动。

## 3. 方案

| 修复点 | 位置 | 内容 |
|---|---|---|
| connect 自提交 | `use-settings-form.ts` `connect` | 显式把 `apiKeys[id]` 写入 `writes` 并以 override 形式 save，不依赖 blur 时序 |
| 已配置 commit 守卫 | `use-settings-form.ts` `commitApiKey` | `configured[id]` 为 true 时 no-op，消除配置翻转后的迟到 blur 重复写 |
| 防中途翻转 | `ModelProviderItem.tsx` 连接按钮 | `onMouseDown={(e) => e.preventDefault()}` 保持输入框焦点，click 序列内不触发 blur commit、不翻转按钮，连接只产生一次 PUT |
| 保留未提交输入 | `use-settings-form.ts` `applyResponse` | 清 `writes`/`clears`，但 `apiKeys` 仅丢弃已 configured 的项，未提交的输入不再被无关响应抹掉 |

修复后点「连接」的时序：mousedown 无 blur → click → connect 显式写 key → 单次 PUT → 响应翻转 configured → 输入框禁用显示「已配置」。blur-commit（点其它处/Tab 保存）语义不变。

已知残留（不修）：键盘 Tab→Enter 流程中，若 blur commit 响应在 Enter 之前返回，「连接」按钮 unmount 后焦点回落 body，Enter 落空（key 已由 blur 保存，无损害）；仅 keydown 与 click 派发之间的毫秒级窗口内可能命中翻转后的按钮，实际基本不可达。触屏平台若在 `touchstart` 即转移焦点（非主流行为），blur PUT 仍可能先于合成 click 返回触发原竞态，未真机验证，判断为低概率。另发现相邻既有问题：`removeCustomProvider` 删除已配置的 custom provider 时不发送 clears，凭据以孤儿状态留存 settings 文件，另行处理。

## 4. 验证

- `use-settings-form.test.tsx` 新增：connect 无 blur 自提交（text + image 组）、无 key 不发请求、已配置 commit no-op、save 响应保留其它 provider 未提交 key、connect 成功后清空该项 apiKeys
- `ModelProviderItem.test.tsx` 新增：点「连接」不触发 blur commit 且输入框保持焦点
- e2e `settings.spec.ts` 新增：DeepSeek 已配置时，为 OpenAI 填 key 点「连接」后两者均 configured（本 bug 原始复现场景）
- 既有 e2e（blur 持久化、重启存活）语义不变
