# Fix：重连对账 fetch 窗口未覆盖已加载视图时 user 消息堆叠到最近处

- 日期：2026-09-02
- 状态：已实施（design review 反馈已处理：循环内 merge 必须原子归约缓冲事件、refreshHistory 循环逐迭代重读 streaming、空页不回写分页、加页数上限、共享 helper 改为两处独立实现；code review 反馈已处理：回补早退路径补 `flushBuffered` 防丢缓冲事件、页级 catch 纳入 parseHistoryMessages、补齐空页/页上限/streaming 翻转三组终止规则测试）
- 调查文档：[`docs/dev/investigation/2026-09-02-chat-user-messages-cluster/README.md`](../../investigation/2026-09-02-chat-user-messages-cluster/README.md)
- 分支：`fix/chat-history-page-coverage`，**叠在 `refactor/chat-runtime-analysis-8f3k2`（PR #81）之上**——修复直接落在重构后的 `history-reconciler.ts` / `history-actions.ts`，PR base 为重构分支，须在 #81 合并后合并

## 症状与根因（摘要）

对话 A,1,B,2,C + 超长 run（≥20 条消息）后重连（合盖开盖 / 移动端挂起恢复），已发送的 A/B/C 集中堆叠到最近处、对应回复消失。根因三条件：user 消息发送后永远 `_optimistic`（无 id 回显）；超长 run 占满 `limit:20` 的最新页使页内无 user 消息；`mergeHistoryMessages` 的 transient 尾部追加假设（"optimistic 比已加载内容新"）在 fetch 窗口未覆盖视图跨度时失效。

## 决策

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 修复层 | **客户端保证覆盖**（fetch 窗口必须覆盖重连前已加载视图的低水位），merge 语义不动。理由：merge 的 transient 追加在"窗口覆盖视图"前提下是正确的；改 merge 保留无 id 中段需要新去重钥匙（现有仅 id 与 optimistic-content 两把），复杂度与出错面远大于补拉 |
| 2 | 低水位定义 | 重连 reconcile 首次 merge **前**的 `session.oldestLoadedId`（上次成功对账的页首 seq）。为 null 时：视图非空（存在无 `_messageId` 的 live 内容）→ 低水位取 0（全量回补）；视图为空或全有 id → 无需回补（null 直接跳过） |
| 3 | 回补循环 | 成功完成最新页原子 merge 后，循环 `while hasMore && oldestLoadedId > lowWater && 页数 < 上限` 逐页 `before: oldestLoadedId` 拉取更早页并 merge。**每页 merge 与首次 merge 同构：同一次 `updateSession` 内先 merge 历史再原子归约缓冲事件**（循环 await 期间新到的 WS 事件继续进缓冲，若不随页归约会静默丢失或被后续页 merge 的 transient 过滤器丢弃）。终止条件：`!hasMore` / `oldestLoadedId <= lowWater` / `isCurrent()` 失效 / 单页 fetch 失败（warn + 终止，部分覆盖优于卡死）/ 空页（**不回写分页字段**，保住 `oldestLoadedId` 防止 null 锁死全量回补）/ 页数上限 50（防止极端积压下重连风暴）。`oldestLoadedId` 严格单调递减，无死循环 |
| 4 | 循环内失败 | 单页 fetch 失败 → warn + 终止循环；已成功的页 merge 已落 session（部分进度持久化） |
| 5 | refreshHistory 同修 | `refreshSessionHistory` 存在同样窗口，采用同一低水位回补规则；**循环每迭代从 session 重读 `streaming`**，翻转为 true 即终止（防止主 merge 被 streaming guard 跳过后 `oldestLoadedId` 不变导致循环卡同一页） |
| 6 | 共享 helper | **不提取**：reconciler 循环（缓冲事件原子归约 + isCurrent 终止）与 refresh 循环（streaming 终止 + plain merge）的 merge 体与终止条件不同，回调化共享得不偿失；两处独立实现同一不变量，终止规则（含空页/上限）由测试双侧覆盖。仅共享低水位计算 `resolveHistoryLowWater` 与页数上限常量（由 `history-actions.ts` 导出） |
| 7 | 不修的部分 | `loadMore` 手动逐页路径的中途闪烁（加载覆盖到 user 消息区间前暂居末尾，覆盖后自愈）——渐进加载语义下接受，记录为已知边界；`loadMore` 与回补循环并发时靠 id 去重保证正确性（浪费少量请求，接受）；H1（run 持久化竞态丢流式回复）为独立已知问题，不在本 fix 范围 |

## 实现

### `runtime/history-reconciler.ts`

- `reconcile` 成功路径：首次 fetch 后、merge 前捕获 `lowWater`（`resolveHistoryLowWater`：`oldestLoadedId` 非空取之；为空且视图存在无 `_messageId` 的 live 内容取 0 全量回补；否则 null 跳过）；原子 merge 不变；随后执行私有 `coverLoadedWindow` 回补循环（决策 #3，每页 merge 含缓冲事件原子归约）
- `finally` 通知语义不变（`succeeded` 以最新页 merge 成功为准；回补循环失败不改变 succeeded）

### `runtime/history-actions.ts`

- 导出 `resolveHistoryLowWater` 与 `COVERAGE_MAX_PAGES`（reconciler 复用）
- `refreshSessionHistory`：fetch 前捕获 lowWater；主 merge 后执行回补循环（逐迭代重读 streaming，决策 #5）
- `loadMoreHistory` 不变

## 测试

- streaming-store.test.ts 复现用例（验收）：30+ 消息场景断言最终视图为完整交错序列 `["old question","old answer","A","1","B","2","C","m1".."m25"]`
- history-reconciler.test.ts：多页回补循环（终止于 `oldestLoadedId <= lowWater`）+ 循环期间缓冲事件随页原子归约
- history-actions.test.ts：`refreshSessionHistory` 回补——低水位 1 + 服务端 25 条，断言单次 refresh 后覆盖至低水位
- 存量用例（含 reconcile / reconnect / 分页全套）必须原样通过——验证回补不破坏既有对账语义
- 验证链：lint → typecheck → `npm test --workspace=packages/app`

## 风险与边界

- **回补请求放大**：除重连外，`TriggerEventBridge` 在每次 `trigger_completed` 都会触发 `refreshHistory`（同样回补）——深滚动会话在触发器频发时可能反复补拉；上限 50 页/次 + 串行执行约束了最坏情况（每页 20 条），接受
- **中间态闪烁**：回补过程中 user 消息短暂位于末尾，页到位后归位——与现状"永久堆叠"相比是净改善
- **H1 未修**：`repro.test.snippet.ts` 仍为 failing 场景（未纳入测试套件），hub runEvents TTL 另行立项
