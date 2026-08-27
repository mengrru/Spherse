# @spherse/i18n

locale catalog 与翻译纯函数 + React 绑定。架构机制（子入口、消费方矩阵、locale 持久化）见 `docs/official/architecture/i18n.md`；文案迁移的操作流程（key 命名、三语同步步骤）见 `.agents/skills/i18n/SKILL.md`。

## 维护规范

- **`zh-CN.ts` 是翻译基准**：`TranslationKey` 类型由其对象 keys 推导（不手写）；`zh-TW` / `en` 必须保持 key 集一致
- **逐条注释**：zh-CN 每条文案必须结合实际 UI 场景写注释（出现位置、上下文、交互状态），用于指导 `zh-TW` 与 `en` 的翻译——注释缺失的 key 在 review 中退回
- 插值占位 `{name}`，三语变量名必须一致（check 会校验）

## 校验与测试

```bash
npm run check            # 三语 key 一致性 + 插值变量一致性（纳入 root verify）
npm test --workspace=packages/i18n
```

新增文案一律走 **i18n** skill，不要手改三语文件绕过流程。
