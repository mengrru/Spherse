# Agent Dialog 提示词模板功能

- **Date**: 2026-06-26
- **Status**: Design
- **Backlog**: 新增 `[ ] agent dialog 提示词模板：点击预制模板 badge 一键载入提示词`

## 1. 背景与动机

当前创建/编辑 agent 时，提示词（`systemPrompt`）只能从空白或单一默认模板（`AGENT_TEMPLATE`）开始手写。用户缺乏「快速起步」入口——尤其对新用户，面对空提示词不知如何下笔。

`@spherse/presets` 虽已有 `PRESET_AGENTS`（项目初始化时创建的 agent），但它只在「新建项目」时种入一份完整 agent，无法在「创建/编辑任意 agent」时复用其提示词；且 `PRESET_AGENTS` 仅携带 `{ name, slug }`，prompt 正文统一取自单一 `AGENT_TEMPLATE` 并做 naive 字符串替换，本质上没有可复用的「提示词模板库」。

本特性在 agent dialog 的提示词区域下方提供一排预制模板 badge，用户点击即可将模板内容载入提示词框，降低创作门槛。

## 2. 目标

- 在 agent 创建/编辑 dialog 的提示词 Textarea 下方，展示一排可点击的预制模板 badge
- 点击 badge 将模板 prompt 载入提示词区域（仅 `systemPrompt`，不影响名称/工具/参考资料）
- 提供 2 个预制模板：世界观创作助手、角色扮演
- 预制模板内容存放在 `@spherse/presets`，随 app 发版
- 载入行为安全：提示词为空时直填，非空时弹确认避免误覆盖
- badge 标签走 i18n，为后续多语言扩展预留

## 3. 非目标

- 不实现用户自定义/导入模板（仅预制）
- 不实现 prompt 正文的多语言（本期 prompt 正文为单语言，与现有 `AGENT_TEMPLATE` 一致；为未来 locale 化预留结构）
- 不改变 `PRESET_AGENTS` 项目初始化逻辑（本特性是「dialog 内可选载入」，与项目种入互不影响）
- 不引入运行时 fetch（模板是构建期常量，直接 import）

## 4. 架构设计

### 4.1 整体方案

预制模板作为构建期常量，从 `@spherse/presets` 直接 import 到前端 `AgentDialog`，不经过 server / core。模板元数据（id、name）声明在 `presets.json`，prompt 正文存为独立 `.md` 文件，由现有 `sync-templates.mjs` 在 prebuild 阶段生成 TS 常量。

```
packages/presets/
  presets.json                           # 声明 presetPromptTemplates: [{ id, name }]
  templates/prompt-templates/
    worldview-assistant.md               # 世界观创作助手 prompt 正文
    roleplay.md                          # 角色扮演 prompt 正文
  scripts/sync-templates.mjs             # 扩展：读取 .md + presets.json → 生成常量
  src/generated/prompt-templates.ts      # (gitignored) PRESET_PROMPT_TEMPLATES
  src/index.ts                           # 导出 PRESET_PROMPT_TEMPLATES
        │
        ▼ 构建 import
packages/app/src/features/agent-session-list/AgentDialog.tsx
  └─ PromptTemplatePicker (新增子组件)
       ├─ 读 PRESET_PROMPT_TEMPLATES
       ├─ 渲染 badge 行（在 Textarea 下方）
       └─ 点击 → setFormData({ systemPrompt: template.prompt })
```

**选择此方案（方案 A）而非其他：**

- **方案 B（prompt 内联到 presets.json 的字符串字段）**：多行 prompt 在 JSON 里需转义，可读性与可维护性差，不利于带格式的 prompt 正文。
- **方案 C（复用 skills 的目录递归扫描模式）**：每模板一个目录 + 递归扫描，对 2 条纯文本 prompt 是过度工程。

方案 A 最贴合现有「`mapping`（单文件→常量）+ `presets.json`（声明清单）」双轨机制：prompt 正文保持 `.md` 可读性，扩展 sync 脚本代价小（新增一个生成步骤，与既有 `PRESET_AGENTS` 生成并列）。

### 4.2 组件改动

#### `packages/presets/presets.json` — 新增 `presetPromptTemplates`

```json
{
  "presetSkills": [ ... ],
  "presetAgents": [ ... ],
  "presetPromptTemplates": [
    { "id": "worldview-assistant", "name": "世界观创作助手" },
    { "id": "roleplay", "name": "角色扮演" }
  ]
}
```

`name` 作为 i18n 缺失时的回退显示名（canonical label）。

#### `packages/presets/templates/prompt-templates/` — 新增 prompt 正文文件

- `worldview-assistant.md` — 世界观创作助手 prompt（纯文本，无 frontmatter；载入后即成为 agent 的 systemPrompt 正文）
- `roleplay.md` — 角色扮演 prompt

文件内容为 prompt 正文本身（与 agent `profile.md` 中 frontmatter 之后的 body 等价），不包含 YAML frontmatter。

#### `packages/presets/scripts/sync-templates.mjs` — 扩展生成步骤

在现有 `PRESET_AGENTS` 生成之后，新增对 `presetPromptTemplates` 的处理：

- 遍历 `presetsConfig.presetPromptTemplates`
- 对每条 `{ id, name }`，读取 `templates/prompt-templates/<id>.md`；文件不存在则 `process.exit(1)`（与 preset skill 目录缺失的同款校验）
- 生成 `src/generated/prompt-templates.ts`：

```ts
export const PRESET_PROMPT_TEMPLATES = [
  { id: "worldview-assistant", name: "世界观创作助手", prompt: "<文件内容>" },
  { id: "roleplay", name: "角色扮演", prompt: "<文件内容>" }
] as const;
```

`prompt` 字段为 `.md` 文件的完整原文（`readFileSync` 后 `JSON.stringify`，保留换行与格式）。

#### `packages/presets/src/index.ts` — 新增导出

```ts
export { PRESET_PROMPT_TEMPLATES } from "./generated/prompt-templates.js";
```

类型由消费方（前端）内联定义，避免在 presets 导出多余类型（遵循 barrel 导出规范）。

#### `packages/app/src/features/agent-session-list/AgentDialog.tsx` — 新增 `PromptTemplatePicker`

在「基本」tab 的提示词 `Field` 内，**Textarea 下方**插入 badge 行。结构：

```
Field(提示词)
  FieldLabel: 提示词
  Textarea(systemPrompt)            // 现有，不变
  PromptTemplatePicker              // 新增
    flex flex-wrap gap-1.5
    [世界观创作助手] [角色扮演]      // Button variant="outline" size="sm"
```

子组件签名（克隆现有 `ToolPicker` 结构）：

```tsx
function PromptTemplatePicker({ onSelect }: { onSelect: (template: { id: string; prompt: string }) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-1.5">
      {PRESET_PROMPT_TEMPLATES.map((tpl) => (
        <Button key={tpl.id} type="button" variant="outline" size="sm"
          onClick={() => onSelect(tpl)}>
          {t(`agent-dialog.template.${tpl.id}`)}
        </Button>
      ))}
    </div>
  );
}
```

badge 标签取 i18n key `agent-dialog.template.<id>`，三语言均补齐（见 §6）。

#### 载入行为（空时直填 / 非空时确认）

在 `AgentDialog` 内引入一个轻量确认机制（`AlertDialog`，复用 `packages/app/src/components/ui/alert-dialog.tsx`）：

- 点击 badge → `handleSelectTemplate(template)`
- 若 `formData.systemPrompt.trim() === ""`：直接 `setFormData(prev => ({ ...prev, systemPrompt: template.prompt }))`
- 否则：打开确认 `AlertDialog`（「应用模板将覆盖当前提示词，是否继续？」），确认后覆盖、取消则关闭不改动

确认弹窗的状态用 `useState<PromptTemplate | null>(null)` 管理（`null` = 关闭，非 `null` = 打开并持有待应用模板）；与现有 `dialog` 单枚举状态解耦，因它是表单内的瞬时交互。

### 4.3 不改动

- `PRESET_AGENTS` / `initPresets()` 的项目初始化逻辑（本特性与项目种入独立）
- `AgentProfile` 类型、agent 创建 API 契约（`agentCreateRequest` 已接受任意 `content`，无需改动）
- `agent-markdown.ts` 的 parse/build 逻辑（模板仅作用于 `formData.systemPrompt`，序列化路径不变）
- server / core 层（模板是纯前端构建期常量）

## 5. 数据流与生命周期

### 5.1 构建期

```
npm run build --workspace=packages/presets
  → prebuild: node scripts/sync-templates.mjs
      ├─ 读 presets.json → presetPromptTemplates
      ├─ 读 templates/prompt-templates/<id>.md
      └─ 生成 src/generated/prompt-templates.ts (PRESET_PROMPT_TEMPLATES)
  → tsc → dist/
```

修改模板 `.md` 或 `presets.json` 后须重新 build presets（或 root `npm run build`），`src/generated/` 随之刷新。

### 5.2 运行期（dialog 交互）

```
用户打开 create/edit agent dialog
  → AgentDialog 渲染 PromptTemplatePicker（读 import 的 PRESET_PROMPT_TEMPLATES）
  → 用户点击 [世界观创作助手]
      ├─ systemPrompt 为空 → 直接填入 template.prompt
      └─ systemPrompt 非空 → AlertDialog 确认 → 填入
  → formData.systemPrompt 更新 → Textarea 受控重渲染
  → 用户继续编辑 / 提交（提交路径不变）
```

模板载入后即成为普通表单内容，用户可继续修改；不保留「来自模板」的元信息。

## 6. i18n

badge 标签走 i18n key，三语言均需补齐（`zh-CN.ts` 为基准并带注释，`en.ts` / `zh-TW.ts` 同步）。新增 key：

| Key | zh-CN | en | zh-TW |
|-----|-------|----|-------|
| `agent-dialog.templateLabel` | 模板 | Templates | 範本 |
| `agent-dialog.template.worldview-assistant` | 世界观创作助手 | Worldbuilding Assistant | 世界觀創作助手 |
| `agent-dialog.template.roleplay` | 角色扮演 | Roleplay | 角色扮演 |
| `agent-dialog.templateConfirmTitle` | 应用模板 | Apply Template | 套用範本 |
| `agent-dialog.templateConfirmDesc` | 应用模板将覆盖当前提示词内容，是否继续？ | This will replace the current prompt. Continue? | 套用範本將覆蓋目前提示詞內容，是否繼續？ |
| `agent-dialog.templateConfirmApply` | 应用 | Apply | 套用 |
| `agent-dialog.templateConfirmCancel` | 取消 | Cancel | 取消 |

`templateLabel` 当前 UI 不强制展示（badge 行可自解释），但预留以便未来加标签。

**prompt 正文本期单语言**（中文），与现有默认 `AGENT_TEMPLATE` 一致。数据结构已为未来 locale 化预留：`presetPromptTemplates[].id` 可作为按 locale 选取 `.md`（如 `roleplay.en.md`）的键，本期不实现。

## 7. 错误处理

- **`.md` 文件缺失**：sync 脚本在 `process.exit(1)` 阻断构建，与 preset skill 目录缺失同款处理；CI/本地构建会立即暴露，不会产出残缺产物。
- **`PRESET_PROMPT_TEMPLATES` 为空**：`PromptTemplatePicker` 渲染空 badge 行（无可见元素），不影响 dialog 其余功能。
- **确认弹窗交互**：取消即关闭，不修改 `formData`；无副作用。

## 8. 测试覆盖

沿用 TDD，先写测试：

- **`packages/presets/__tests__/sync-templates.test.ts`**：
  - `presets.json` 的 `presetPromptTemplates` 每条 `id` 对应的 `templates/prompt-templates/<id>.md` 存在
  - 生成的 `PRESET_PROMPT_TEMPLATES` 包含正确的 `{ id, name, prompt }`，prompt 为对应 `.md` 原文
  - id 在 `presetPromptTemplates` 内唯一
- **`packages/app`（`PromptTemplatePicker` / `AgentDialog` 行为）**：
  - 提示词为空时点击 badge → 直接填入 `template.prompt`
  - 提示词非空时点击 badge → 弹确认；确认 → 覆盖；取消 → 不变
  - create / edit 两种 mode 均渲染 badge 行
  - badge 标签随 locale 切换（i18n）

## 9. 影响面

### 9.1 代码改动清单

| 文件 | 改动 |
|------|------|
| `packages/presets/presets.json` | 新增 `presetPromptTemplates` 数组 |
| `packages/presets/templates/prompt-templates/worldview-assistant.md` | 新增 |
| `packages/presets/templates/prompt-templates/roleplay.md` | 新增 |
| `packages/presets/scripts/sync-templates.mjs` | 新增生成 `prompt-templates.ts` 步骤 |
| `packages/presets/src/index.ts` | 导出 `PRESET_PROMPT_TEMPLATES` |
| `packages/presets/__tests__/sync-templates.test.ts` | 新增 prompt 模板断言 |
| `packages/app/src/features/agent-session-list/AgentDialog.tsx` | 新增 `PromptTemplatePicker` 子组件 + 载入/确认逻辑 |
| `packages/i18n/src/locales/zh-CN.ts` | 新增 `agent-dialog.template*` key（带注释） |
| `packages/i18n/src/locales/en.ts` | 同步 |
| `packages/i18n/src/locales/zh-TW.ts` | 同步 |

### 9.2 文档同步（`docs/official/`）

- **`architecture.md`** / **`project-structure.md`**：在 `@spherse/presets` 说明中补充「预制提示词模板（`presetPromptTemplates`）」条目。
- **`data-conventions.md`**：如有 agent dialog / preset 相关章节，补充 prompt 模板的数据来源与载入行为说明。

### 9.3 Backlog 维护

- 完成后标记 `[x] agent dialog 提示词模板` 条目。
- 视情况新增后续 backlog：用户自定义模板导入、prompt 正文 locale 化。

## 10. 预制模板 prompt 草案

以下为初始 prompt 正文草案，实现阶段可细化：

### worldview-assistant.md（世界观创作助手）

引导 agent 作为世界观创作助手，协助用户结构化构建世界观要素（地理、历史、势力、规则体系、文化），保持与已有设定的一致性，输出条理清晰、可被后续创作复用。

### roleplay.md（角色扮演）

引导 agent 扮演用户设定的角色进行沉浸式对话，保持人设、语气、行为动机与记忆一致性，在互动中推进情节而非跳出角色。
