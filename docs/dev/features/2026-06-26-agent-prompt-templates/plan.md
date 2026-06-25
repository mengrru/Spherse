# 实施计划：Agent Dialog 提示词模板功能

- **Date**: 2026-06-26
- **Design**: `docs/dev/features/2026-06-26-agent-prompt-templates/design.md`

## 任务依赖图

```
Task 1 (presets 数据层) ──┐
Task 2 (i18n 文案)   ─────┼──> Task 3 (App UI + 测试)
                          │
                   (1 与 2 可并行)
```

Task 1、2 无相互依赖，可并行。Task 3 依赖 1（`PRESET_PROMPT_TEMPLATES` 导出）和 2（i18n key）。

---

## Task 1 — presets 数据层

**目标**：新增预制提示词模板数据，通过 `@spherse/presets` 导出 `PRESET_PROMPT_TEMPLATES` 常量。

### 1.1 新增模板正文文件

创建 `packages/presets/templates/prompt-templates/`：

**`worldview-assistant.md`**（世界观创作助手）：
```
你是一个专业的世界观创作助手，协助用户构建完整、自洽的世界观设定。

## 核心职责

- 帮助用户梳理世界观的各项要素：地理环境、历史脉络、势力格局、规则体系（魔法/科技/社会）、文化与信仰
- 始终保持新设定与已有设定的一致性，发现矛盾时主动提醒
- 输出条理清晰、结构化的内容，便于后续创作复用

## 创作风格

- 先理解用户意图，再展开创作，避免过度发散
- 提供具体细节而非空泛描述，必要时给出多个方案供选择
- 对设定的逻辑自洽性负责，标注假设与待定项
```

**`roleplay.md`**（角色扮演）：
```
你将扮演用户设定的角色，进行沉浸式的互动对话。

## 行为准则

- 严格保持角色的人设：性格、语气、说话方式、行为动机
- 在对话中维持角色记忆与经历的一致性，不跳出角色
- 通过角色的视角推进情节，而非以旁白或助手身份解说
- 当用户的输入超出角色认知时，以角色会有的方式自然回应

## 注意事项

- 主动驱动情节发展，不被动等待
- 描写注重氛围与代入感，避免机械式陈述
- 如需打破沉浸（如澄清规则），用括号或明显标注与角色对话区分
```

> 以上为初始草案，实现时可微调措辞。

### 1.2 修改 `packages/presets/presets.json`

新增 `presetPromptTemplates` 数组（与现有 `presetAgents` 平级）：

```json
"presetPromptTemplates": [
  { "id": "worldview-assistant", "name": "世界观创作助手" },
  { "id": "roleplay", "name": "角色扮演" }
]
```

### 1.3 扩展 `packages/presets/scripts/sync-templates.mjs`

在生成 `presets.ts` 之后（约 line 39 后），新增生成 `prompt-templates.ts` 的逻辑：

```js
const promptTemplatesDir = join(templatesDir, "prompt-templates");
const presetPromptTemplates = (presetsConfig.presetPromptTemplates ?? []).map((tpl) => {
  const filePath = join(promptTemplatesDir, `${tpl.id}.md`);
  if (!existsSync(filePath)) {
    console.error(`preset prompt template not found: ${tpl.id}.md`);
    process.exit(1);
  }
  return { id: tpl.id, name: tpl.name, prompt: readFileSync(filePath, "utf-8") };
});

const promptTemplatesTsContent = `export const PRESET_PROMPT_TEMPLATES = ${JSON.stringify(presetPromptTemplates, null, 2)} as const;\n`;
writeFileSync(join(generatedDir, "prompt-templates.ts"), promptTemplatesTsContent, "utf-8");
console.log("synced: prompt templates → src/generated/prompt-templates.ts (PRESET_PROMPT_TEMPLATES)");
```

要点：
- 复用文件顶部已 import 的 `readFileSync`/`writeFileSync`/`existsSync`/`join`
- `.md` 文件缺失 → `process.exit(1)`，与 preset skill 目录校验同款（line 28-31）
- `presetsConfig.presetPromptTemplates ?? []` 用 `??` 防御旧 config 无此字段（向前兼容）

### 1.4 修改 `packages/presets/src/index.ts`

新增导出：

```ts
export { PRESET_PROMPT_TEMPLATES } from "./generated/prompt-templates.js";
```

### 1.5 测试 `packages/presets/__tests__/sync-templates.test.ts`

新增测试用例（在现有 `describe` 内）：

```ts
it("generates prompt-templates.ts with PRESET_PROMPT_TEMPLATES matching presets.json", async () => {
  const content = fs.readFileSync(path.join(generatedDir, "prompt-templates.ts"), "utf-8");
  expect(content).toContain("export const PRESET_PROMPT_TEMPLATES");

  const { PRESET_PROMPT_TEMPLATES } = await import("../src/generated/prompt-templates.js");
  const declared = presetsConfig.presetPromptTemplates;
  expect(PRESET_PROMPT_TEMPLATES.length).toBe(declared.length);

  const ids = declared.map((t) => t.id);
  expect(new Set(ids).size).toBe(ids.length); // id 唯一

  for (const tpl of PRESET_PROMPT_TEMPLATES) {
    const declaredTpl = declared.find((d) => d.id === tpl.id);
    expect(declaredTpl).toBeDefined();
    expect(tpl.name).toBe(declaredTpl.name);
    const mdPath = path.join(rootDir, "templates", "prompt-templates", `${tpl.id}.md`);
    expect(fs.existsSync(mdPath)).toBe(true);
    const actual = fs.readFileSync(mdPath, "utf-8");
    expect(tpl.prompt).toBe(actual); // prompt 为 .md 原文
  }
});
```

### 1.6 验证

```bash
npm run build --workspace=packages/presets   # 触发 prebuild → 生成 prompt-templates.ts
npm test --workspace=packages/presets
```

确认 `src/generated/prompt-templates.ts` 生成且测试通过。

---

## Task 2 — i18n 文案

**目标**：三个 locale 文件新增 prompt 模板相关 key。

在 `agent-dialog.tabTheme` 之后、`agent-session-list` 区块之前，插入以下 key：

### `packages/i18n/src/locales/zh-CN.ts`（基准，带注释，line 114 后）

```ts
// Agent dialog 提示词模板行标签（预留，当前 UI 未强制展示）
"agent-dialog.templateLabel": "模板",
// 预制提示词模板：世界观创作助手 badge 文案
"agent-dialog.template.worldview-assistant": "世界观创作助手",
// 预制提示词模板：角色扮演 badge 文案
"agent-dialog.template.roleplay": "角色扮演",
// 提示词非空时点击模板的确认弹窗标题
"agent-dialog.templateConfirmTitle": "应用模板",
// 确认弹窗正文：提示将覆盖当前提示词
"agent-dialog.templateConfirmDesc": "应用模板将覆盖当前提示词内容，是否继续？",
// 确认弹窗「应用」按钮
"agent-dialog.templateConfirmApply": "应用",
// 确认弹窗「取消」按钮
"agent-dialog.templateConfirmCancel": "取消",
```

### `packages/i18n/src/locales/en.ts`（line 57 后）

```ts
"agent-dialog.templateLabel": "Templates",
"agent-dialog.template.worldview-assistant": "Worldbuilding Assistant",
"agent-dialog.template.roleplay": "Roleplay",
"agent-dialog.templateConfirmTitle": "Apply Template",
"agent-dialog.templateConfirmDesc": "This will replace the current prompt. Continue?",
"agent-dialog.templateConfirmApply": "Apply",
"agent-dialog.templateConfirmCancel": "Cancel",
```

### `packages/i18n/src/locales/zh-TW.ts`（line 57 后）

```ts
"agent-dialog.templateLabel": "範本",
"agent-dialog.template.worldview-assistant": "世界觀創作助手",
"agent-dialog.template.roleplay": "角色扮演",
"agent-dialog.templateConfirmTitle": "套用範本",
"agent-dialog.templateConfirmDesc": "套用範本將覆蓋目前提示詞內容，是否繼續？",
"agent-dialog.templateConfirmApply": "套用",
"agent-dialog.templateConfirmCancel": "取消",
```

### 验证

```bash
npm test --workspace=packages/i18n   # 确认 key 完整性校验通过
```

---

## Task 3 — App UI（PromptTemplatePicker）+ 测试

**前置**：Task 1（`PRESET_PROMPT_TEMPLATES` 已导出）、Task 2（i18n key 已就位）。

### 3.1 修改 `packages/app/src/features/agent-session-list/AgentDialog.tsx`

**(a) 新增 import**

```tsx
import { AGENT_TEMPLATE, AGENT_THEME_TEMPLATE, PRESET_PROMPT_TEMPLATES } from "@spherse/presets";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../../components/ui/alert-dialog";
```

> 在文件顶部既有 import 区按类别插入；`AlertDialog*` 从 `../../components/ui/alert-dialog` 导入（与现有 dialog 导入风格一致）。

**(b) 定义模板类型（组件外，靠近 `AgentFormData` import 区）**

```tsx
type PromptTemplate = (typeof PRESET_PROMPT_TEMPLATES)[number];
```

**(c) 在 `AgentDialog` 组件内新增状态**

紧接现有 `useState` 块（line 41-42 之后）：

```tsx
const [confirmTemplate, setConfirmTemplate] = useState<PromptTemplate | null>(null);
```

> `null` = 确认弹窗关闭；非 null = 打开并持有待应用模板。

**(d) 新增 handler**

```tsx
const handleSelectTemplate = (template: PromptTemplate) => {
  if (formData.systemPrompt.trim() === "") {
    setFormData((prev) => ({ ...prev, systemPrompt: template.prompt }));
  } else {
    setConfirmTemplate(template);
  }
};

const applyTemplate = () => {
  if (confirmTemplate) {
    setFormData((prev) => ({ ...prev, systemPrompt: confirmTemplate.prompt }));
    setConfirmTemplate(null);
  }
};
```

**(e) 在提示词 Field 内 Textarea 之后插入 badge 行（line 113 之后、`</Field>` 之前）**

```tsx
<PromptTemplatePicker onSelect={handleSelectTemplate} />
```

**(f) 新增确认弹窗**

在 `</Dialog>` 之前（`DialogFooter` 之后）或 `DialogContent` 末尾插入：

```tsx
<AlertDialog open={confirmTemplate !== null} onOpenChange={(open) => { if (!open) setConfirmTemplate(null); }}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{t("agent-dialog.templateConfirmTitle")}</AlertDialogTitle>
      <AlertDialogDescription>{t("agent-dialog.templateConfirmDesc")}</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>
        {t("agent-dialog.templateConfirmCancel")}
      </AlertDialogCancel>
      <AlertDialogAction onClick={applyTemplate}>
        {t("agent-dialog.templateConfirmApply")}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

> `AlertDialog` 用 `open` 受控；`AlertDialogAction` 是纯 Button（内部未包 `AlertDialogPrimitive.Close`，不自动关闭），点击触发 `applyTemplate`，由其内 `setConfirmTemplate(null)` 关闭。`AlertDialogCancel` 内部包了 `AlertDialogPrimitive.Close`，点击会自动触发 `onOpenChange(false)` → 已设的 handler 会 `setConfirmTemplate(null)`，故无需额外 onClick。

**(g) 新增 `PromptTemplatePicker` 子组件**

放在文件末尾（`ContextPathField` 之后），克隆 `ToolPicker` 结构：

```tsx
function PromptTemplatePicker({ onSelect }: { onSelect: (template: PromptTemplate) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-1.5">
      {PRESET_PROMPT_TEMPLATES.map((tpl) => (
        <Button key={tpl.id} type="button" variant="outline" size="sm" onClick={() => onSelect(tpl)}>
          {t(`agent-dialog.template.${tpl.id}`)}
        </Button>
      ))}
    </div>
  );
}
```

> 注意：不在外层包 `<Field>`（badge 行是提示词 Field 的子内容，无独立 label）。`variant="outline"`（不可选中态，每次点击都是载入动作）。

### 3.2 测试

在 `packages/app` 下新增/扩展测试（参考既有 AgentDialog 测试位置与测试框架，通常在 `packages/app/src/features/agent-session-list/` 同级 `__tests__/` 或 `.test.tsx`）：

测试用例：
1. **空提示词点击 badge → 直接填入**：渲染 create 模式 dialog，点击某模板 badge，断言 Textarea 值 === 该模板 prompt
2. **非空提示词点击 badge → 弹确认**：先在 Textarea 输入内容，点击 badge，断言确认弹窗出现
3. **确认 → 覆盖**：弹窗中点击「应用」，断言 Textarea 值 === 模板 prompt
4. **取消 → 不变**：弹窗中点击「取消」，断言 Textarea 值保持原内容
5. **create / edit 两种 mode 均渲染 badge 行**（简单断言 badge 文本存在）

> 若 `AgentDialog` 当前无测试文件，新建 `packages/app/src/features/agent-session-list/AgentDialog.test.tsx`，参考同目录或邻近 feature 的测试写法（`@testing-library/react` + `vitest`）。mock `@spherse/presets` 的 `PRESET_PROMPT_TEMPLATES` 与 i18n。

### 3.3 验证

```bash
npm run lint --workspace=packages/app
npm test --workspace=packages/app
npm run build --workspace=packages/app   # 或按项目约定
```

---

## 整体验证（全部 Task 完成后）

```bash
npm run build           # 确保 presets→app 全链路编译通过
npm run lint            # 全仓库 lint
npm test --workspace=packages/presets
npm test --workspace=packages/i18n
npm test --workspace=packages/app
```

可选（若改动涉及 dialog 渲染）：`npm run test:e2e --workspace=packages/app -- e2e/<相关 spec>` 按 AGENTS.md E2E 验证选择执行。

## 影响面 / 文档同步备忘

- 完成后更新 `docs/official/`：`architecture.md` / `project-structure.md` 补充 `presetPromptTemplates` 说明（若 presets 相关章节存在）
- 更新 `docs/dev/backlog.md`：标记 `[x] agent dialog 提示词模板`
- 不需要 commit（等待用户明确要求）

## 风险点

- `AlertDialogAction` 是否自动关闭弹窗：base-ui 的 `AlertDialogAction` 是纯 Button（不绑 Close），需在 `onClick` 手动 `setConfirmTemplate(null)`——已在上面的 `applyTemplate` 处理。若 base-ui 行为不同，实现时验证一次。
- i18n key 完整性：三语言文件必须同步新增，否则 `t()` 回退可能显示 key 本身。Task 2 已覆盖三语言。
