# [fix] 去掉 agent 的 creator 标签及相关字段

## 问题

Agent 的 `type` 字段当前唯一实际使用的值是 `"creator"`，在 UI 上以 Badge 形式展示（`Header.tsx`），但该字段不参与任何业务逻辑——engine 通过 `profile.tools` 数组选择工具，不依赖 `type`。"creator" 标签对用户无信息量，属于冗余 UI 元素。

**影响范围**：

| 位置 | 当前行为 |
|------|---------|
| `packages/core/src/types.ts:21` | `AgentProfile.type: string` |
| `packages/app/src/lib/types.ts:7` | app 层重复定义 `type: string` |
| `packages/core/src/store/agent-profile.ts:59` | `save()` 校验 `type` 为必填 |
| `packages/core/src/store/agent-profile.ts:136` | `parseFile()` 跳过无 `type` 的文件 |
| `packages/app/src/lib/agent-markdown.ts:65-67` | 新建 agent 时默认写 `type: "creator"` |
| `packages/app/src/features/chat/Header.tsx:12` | Badge 显示 `agent.type` |
| `packages/presets/templates/agent-template.md:3` | 模板中硬编码 `type: creator` |

## 方案

**从 `AgentProfile` 中移除 `type` 字段**，同时清理所有引用。

选择理由：`type` 不参与任何运行时逻辑，MVP 设计文档中规划的 `"roleplay"` / `"scheduler"` 等类型尚未实现，保留空壳字段违反 YAGNI。未来如果需要 agent 分类，可以重新引入——届时需求会更明确，字段设计也会更准确。

**向后兼容**：已有用户数据中 `profile.md` 的 `type: creator` frontmatter 会被保留——`agent-markdown.ts` 的 `parseAgentMarkdown()` 通过 `...extra` 将未知字段收集到 `extraFrontmatter`，`buildAgentMarkdown()` 将其原样写回。`agent-profile.ts` 的 `parseFile()` 使用 gray-matter 解析，未映射到 `AgentProfile` 的字段留在原始数据中，不会丢失。

## 改动范围

### `packages/core/src/types.ts`

- 从 `AgentProfile` 移除 `type: string`（第 21 行）

### `packages/app/src/lib/types.ts`

- 从 app 层 `AgentProfile` 移除 `type: string`（第 7 行）

### `packages/core/src/store/agent-profile.ts`

- `save()`（第 59 行）：移除 `typeof data.type !== "string"` 校验，仅保留 `name` 必填检查；错误信息改为 `"agent profile name is required"`
- `parseFile()`（第 136 行）：移除 `!data.type` 条件，仅检查 `!data.name`
- `parseFile()` 返回对象（第 149 行）：移除 `type: data.type`

### `packages/app/src/lib/agent-markdown.ts`

- `buildAgentMarkdown()`（第 65-67 行）：删除整个 `if (isCreate && !frontmatter.type)` 块

### `packages/app/src/features/chat/Header.tsx`

- 移除 `<Badge variant="secondary">{agent.type}</Badge>`（第 12 行）
- 移除 `Badge` import（第 2 行）

### `packages/presets/templates/agent-template.md`

- 移除 `type: creator` 行（第 3 行）
- 同步生成 `packages/presets/src/generated/agent-template.ts`（执行 `npm run build --workspace=packages/presets`）

### `packages/core/src/__tests__/store/agent-profile.test.ts`

- 测试 fixture `VALID_PROFILE` 中保留 `type: assistant`（验证 extraFrontmatter round-trip），但移除对 `profile.type` 的断言（第 49、66 行）
- "skips profile.md without required frontmatter fields" 测试（第 109 行）：当前 fixture 为 `name: NoType`（有 name、无 type），修改后会被正常解析，需将 fixture 改为无 `name` 的情况（如 `---\ntools: []\n---\ncontent`）
- `save()` 必填校验测试（第 203 行）：当前 fixture 为 `name: NoType`（有 name、无 type），修改后不会抛错，需将 fixture 改为无 `name` 的情况，错误信息断言改为 `"agent profile name is required"`

### `scripts/verify.mjs`

- 测试 fixture 中移除 `type` 行，断言中移除对 `parsed.type` / `alice?.type` 的检查

## 不改动的文件

- `packages/server/src/routes/agents.ts`、`agent-write.ts` — 不引用 `type` 字段，透传 markdown 内容
- `packages/core/src/engine.ts` — 不使用 `type`
- `packages/i18n/` — "creator" 从未国际化，无相关 key
- `packages/app/src/components/AgentDialog.tsx` — 通过 `extraFrontmatter` round-trip `type`，无需改动

## 验证方式

1. `npm test --workspace=packages/core` 通过
2. `npm test --workspace=packages/app` 通过
3. `npm run lint` 通过
4. 手动验证：新建 agent → 列表中可见 → 打开 chat → Header 仅显示名称，无 Badge
5. 手动验证：编辑已有含 `type: creator` 的 agent → 保存后 frontmatter 中 `type` 保留
