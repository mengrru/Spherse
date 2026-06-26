import { useState, useMemo } from "react";
import { AGENT_TEMPLATE, AGENT_THEME_TEMPLATE, PRESET_PROMPT_TEMPLATES } from "@spherse/presets";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { useI18n } from "@spherse/i18n/react";
import { parseAgentMarkdown, buildAgentMarkdown } from "../../lib/agent-markdown";
import type { AgentFormData } from "../../lib/agent-markdown";
import { TOOL_GROUPS } from "../../lib/tool-registry";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
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
import { Field, FieldGroup, FieldLabel } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { SearchFileField } from "./SearchFileField";
import { XIcon } from "lucide-react";

function getErrorMessage(err: unknown, t: (key: string) => string): string {
  return err instanceof Error ? err.message : t("agent-dialog.saveFailed");
}

interface AgentDialogProps {
  mode: "create" | "edit";
  initialContent?: string;
  initialThemeContent?: string;
  onSubmit: (slug: string, content: string, themeContent: string) => Promise<void>;
  onCancel: () => void;
}

type PromptTemplate = (typeof PRESET_PROMPT_TEMPLATES)[number];

export function AgentDialog({ mode, initialContent, initialThemeContent, onSubmit, onCancel }: AgentDialogProps) {
  const { t } = useI18n();
  const raw = initialContent ?? AGENT_TEMPLATE;
  const parsed = useMemo(() => parseAgentMarkdown(raw), [raw]);
  const [formData, setFormData] = useState<AgentFormData>(parsed.formData);
  const [themeContent, setThemeContent] = useState(initialThemeContent ?? AGENT_THEME_TEMPLATE);
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
    const slug = formData.name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "");
    try { await onSubmit(slug, content, themeContent); }
    catch (err: unknown) { setError(getErrorMessage(err, t)); setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="h-[80vh] flex flex-col sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? t("agent-dialog.createTitle") : t("agent-dialog.editTitle")}
          </DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="basic" className="min-h-0 flex-1 flex flex-col">
          <TabsList className="mx-4 mt-1">
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
              <ToolPicker selectedTools={formData.tools} onToggleGroup={toggleGroup} />
              <ContextPathField
                contextPaths={formData.context}
                onAdd={addContext}
                onRemove={removeContext}
              />
              <Field>
                <FieldLabel>{t("agent-dialog.promptLabel")}</FieldLabel>
                <Textarea
                  className="min-h-40 resize-y font-mono"
                  value={formData.systemPrompt}
                  onChange={(e) => setFormData((prev) => ({ ...prev, systemPrompt: e.target.value }))}
                  spellCheck={false}
                />
                <PromptTemplatePicker onSelect={handleSelectTemplate} />
              </Field>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </FieldGroup>
          </TabsContent>
          <TabsContent value="theme" className="flex-1 min-h-0 px-4">
            <Textarea
              className="h-full resize-none font-mono text-xs"
              value={themeContent}
              onChange={(e) => setThemeContent(e.target.value)}
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
      </DialogContent>
    </Dialog>
  );
}

function ToolPicker({
  selectedTools,
  onToggleGroup,
}: {
  selectedTools: string[];
  onToggleGroup: (groupToolIds: string[]) => void;
}) {
  const { t } = useI18n();
  return (
    <Field>
      <FieldLabel>{t("agent-dialog.toolsLabel")}</FieldLabel>
      <div className="flex flex-wrap gap-1.5">
        {TOOL_GROUPS.map((group) => {
          const selected = group.toolIds.every((id) => selectedTools.includes(id));
          return (
            <Button
              key={group.label}
              type="button"
              variant={selected ? "default" : "outline"}
              size="sm"
              onClick={() => onToggleGroup(group.toolIds)}
            >
              {t(group.label)}
            </Button>
          );
        })}
      </div>
    </Field>
  );
}

function ContextPathField({
  contextPaths,
  onAdd,
  onRemove,
}: {
  contextPaths: string[];
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Field>
      <FieldLabel>{t("agent-dialog.refsLabel")}</FieldLabel>
      {contextPaths.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {contextPaths.map((path) => (
            <Badge key={path} variant="secondary" className="gap-1">
              {path}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="-mr-1 size-4"
                onClick={() => onRemove(path)}
              >
                <XIcon />
              </Button>
            </Badge>
          ))}
        </div>
      )}
      <SearchFileField
        exclude={contextPaths}
        onSelect={onAdd}
        placeholder={t("agent-dialog.refsPlaceholder")}
      />
    </Field>
  );
}

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
