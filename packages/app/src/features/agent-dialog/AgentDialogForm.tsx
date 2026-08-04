import { useState, useMemo } from "react";
import { useI18n } from "@spherse/i18n/react";
import type { TranslationKey } from "@spherse/i18n";
import { parseAgentMarkdown, buildAgentMarkdown } from "./agent-markdown";
import type { AgentFormData } from "./agent-markdown";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import { DialogFooter } from "../../components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { ToolPicker } from "./ToolPicker";
import { ContextPathField } from "./ContextPathField";
import { TimePerceptionField } from "./TimePerceptionField";
import { HintLabel } from "./HintLabel";
import { PromptTemplatePicker, type PromptTemplate } from "./PromptTemplatePicker";
import type { LoadedAgentData } from "./AgentDialog";

function getErrorMessage(err: unknown, t: (key: TranslationKey) => string): string {
  return err instanceof Error ? err.message : t("agent-dialog.saveFailed");
}

interface AgentDialogFormProps {
  initial: LoadedAgentData;
  mode: "create" | "edit";
  onSubmit: (slugBase: string, content: string, themeContent: string) => Promise<void>;
  onCancel: () => void;
}

export function AgentDialogForm({ initial, mode, onSubmit, onCancel }: AgentDialogFormProps) {
  const { t } = useI18n();
  const parsed = useMemo(() => parseAgentMarkdown(initial.raw), [initial.raw]);
  const [formData, setFormData] = useState<AgentFormData>(parsed.formData);
  const [themeContent, setThemeContent] = useState(initial.theme);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmTemplate, setConfirmTemplate] = useState<PromptTemplate | null>(null);

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

  const addContext = (path: string) => {
    if (!formData.context.includes(path)) {
      setFormData((prev) => ({ ...prev, context: [...prev.context, path] }));
    }
  };

  const removeContext = (path: string) => {
    setFormData((prev) => ({ ...prev, context: prev.context.filter((c) => c !== path) }));
  };

  const toggleGroup = (groupToolIds: string[]) => {
    setFormData((prev) => {
      const allSelected = groupToolIds.every((id) => prev.tools.includes(id));
      if (allSelected) {
        return { ...prev, tools: prev.tools.filter((t) => !groupToolIds.includes(t)) };
      }
      const newTools = [...prev.tools];
      for (const id of groupToolIds) {
        if (!newTools.includes(id)) newTools.push(id);
      }
      return { ...prev, tools: newTools };
    });
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) { setError(t("agent-dialog.nameRequired")); return; }
    setSaving(true); setError(null);
    const content = buildAgentMarkdown(formData, parsed.extraFrontmatter, mode === "create");
    const slugBase = formData.name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "");
    try { await onSubmit(slugBase, content, themeContent); }
    catch (err: unknown) { setError(getErrorMessage(err, t)); setSaving(false); }
  };

  return (
    <>
      <Tabs defaultValue="basic" className="min-h-0 flex-1 flex flex-col">
        <TabsList className="mx-4 mt-1 mb-2">
          <TabsTrigger value="basic">{t("agent-dialog.tabBasic")}</TabsTrigger>
          <TabsTrigger value="theme">{t("agent-dialog.tabTheme")}</TabsTrigger>
        </TabsList>
        <TabsContent value="basic" className="flex-1 min-h-0 overflow-y-auto px-4">
          <FieldGroup>
            <Field>
              <FieldLabel>{t("agent-dialog.nameLabel")}</FieldLabel>
              <Input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={t("agent-dialog.namePlaceholder")}
              />
            </Field>
            <Field>
              <HintLabel hint={t("agent-dialog.aliasHint")}>{t("agent-dialog.aliasLabel")}</HintLabel>
              <Input
                type="text"
                value={formData.alias ?? ""}
                onChange={(e) => setFormData((prev) => ({ ...prev, alias: e.target.value }))}
                placeholder={t("agent-dialog.aliasPlaceholder")}
              />
            </Field>
            <ToolPicker selectedTools={formData.tools} onToggleGroup={toggleGroup} />
            <ContextPathField
              contextPaths={formData.context}
              onAdd={addContext}
              onRemove={removeContext}
            />
            <Field>
              <HintLabel hint={t("agent-dialog.promptHint")}>{t("agent-dialog.promptLabel")}</HintLabel>
              <Textarea
                className="min-h-40 max-h-70 resize-y font-mono"
                value={formData.systemPrompt}
                onChange={(e) => setFormData((prev) => ({ ...prev, systemPrompt: e.target.value }))}
                placeholder={t("agent-dialog.promptPlaceholder")}
                spellCheck={false}
              />
              <PromptTemplatePicker onSelect={handleSelectTemplate} />
            </Field>
            <TimePerceptionField
              value={formData.timePerception}
              onChange={(tp) => setFormData((prev) => ({ ...prev, timePerception: tp }))}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </FieldGroup>
        </TabsContent>
        <TabsContent value="theme" className="flex-1 min-h-0 flex flex-col px-4">
          <p className="mb-4 text-sm text-muted-foreground">
            {t("agent-dialog.themeScopeHint")}
          </p>
          <Textarea
            className="flex-1 min-h-0 resize-none font-mono text-xs"
            value={themeContent}
            onChange={(e) => setThemeContent(e.target.value)}
            placeholder={t("agent-dialog.themePlaceholder")}
            spellCheck={false}
          />
        </TabsContent>
      </Tabs>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={saving}
        >
          {saving ? t("common.saving") : mode === "create" ? t("common.create") : t("common.save")}
        </Button>
      </DialogFooter>
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
    </>
  );
}
