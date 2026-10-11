import { useState, useMemo, useEffect } from "react";
import { useI18n } from "@spherse/i18n/react";
import type { TranslationKey } from "@spherse/i18n";
import type { ProviderCatalogItem } from "@spherse/core";
import { parseAgentMarkdown, buildAgentMarkdown } from "./agent-markdown";
import type { AgentFormData } from "./agent-markdown";
import { useGlobalApiClient } from "../../lib/use-connection";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { Button } from "../../components/ui/button";
import { DialogFooter } from "../../components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Switch } from "../../components/ui/switch";
import { Label } from "../../components/ui/label";
import { ToolPicker } from "./ToolPicker";
import { ADVANCED_TOOL_IDS } from "./tool-registry";
import { ModelConfigField, modelExistsInCatalog } from "./ModelConfigField";
import { PathListField } from "./PathListField";
import { TimePerceptionField } from "./TimePerceptionField";
import { HintLabel } from "./HintLabel";
import { PromptTemplatesDialog } from "./PromptTemplatesDialog";
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
  const globalClient = useGlobalApiClient();
  const parsed = useMemo(() => parseAgentMarkdown(initial.raw), [initial.raw]);
  const [formData, setFormData] = useState<AgentFormData>(parsed.formData);
  const [themeContent, setThemeContent] = useState(initial.theme);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [providers, setProviders] = useState<Record<string, ProviderCatalogItem> | null>(null);
  const [configuredProviders, setConfiguredProviders] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!globalClient) return;
    let cancelled = false;
    Promise.all([
      globalClient.getSupportedProviders().catch(() => null),
      globalClient.getModelSettings().catch(() => null),
    ]).then(([catalog, settings]) => {
      if (cancelled) return;
      if (catalog) setProviders(catalog);
      const configured: Record<string, boolean> = {};
      for (const [id, entry] of Object.entries(settings?.models.text.providers ?? {})) {
        if (entry.configured) configured[id] = true;
      }
      setConfiguredProviders(configured);
    });
    return () => {
      cancelled = true;
    };
  }, [globalClient]);

  useEffect(() => {
    if (providers == null) return;
    setFormData((prev) => {
      if (!prev.model || modelExistsInCatalog(prev.model, providers)) return prev;
      return { ...prev, model: undefined };
    });
  }, [providers]);

  const addContext = (path: string) => {
    if (!formData.context.includes(path)) {
      setFormData((prev) => ({ ...prev, context: [...prev.context, path] }));
    }
  };

  const removeContext = (path: string) => {
    setFormData((prev) => ({ ...prev, context: prev.context.filter((c) => c !== path) }));
  };

  const addQuickLink = (path: string) => {
    if (!formData.quickLinks.includes(path)) {
      setFormData((prev) => ({ ...prev, quickLinks: [...prev.quickLinks, path] }));
    }
  };

  const removeQuickLink = (path: string) => {
    setFormData((prev) => ({ ...prev, quickLinks: prev.quickLinks.filter((c) => c !== path) }));
  };

  const toggleGroup = (groupToolIds: string[]) => {
    setFormData((prev) => {
      const allSelected = groupToolIds.every((id) => prev.tools.includes(id));
      const nextTools = allSelected
        ? prev.tools.filter((t) => !groupToolIds.includes(t))
        : [...prev.tools, ...groupToolIds.filter((id) => !prev.tools.includes(id))];
      const hasAdvanced = nextTools.some((id) => ADVANCED_TOOL_IDS.includes(id));
      return { ...prev, tools: nextTools, yolo: hasAdvanced ? prev.yolo : false };
    });
  };

  const hasAdvancedTool = formData.tools.some((id) => ADVANCED_TOOL_IDS.includes(id));

  const handleSubmit = async () => {
    if (!formData.name.trim()) { setError(t("agent-dialog.nameRequired")); return; }
    setSaving(true); setError(null);
    const effectiveFormData = hasAdvancedTool ? formData : { ...formData, yolo: false };
    const content = buildAgentMarkdown(effectiveFormData, parsed.extraFrontmatter, mode === "create");
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
          <TabsTrigger value="personalization">{t("agent-dialog.tabPersonalization")}</TabsTrigger>
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
            <ModelConfigField
              providers={providers ?? {}}
              configuredProviders={configuredProviders}
              model={formData.model}
              thinkingLevel={formData.thinkingLevel}
              onModelChange={(model) => setFormData((prev) => ({ ...prev, model }))}
              onThinkingLevelChange={(thinkingLevel) =>
                setFormData((prev) => ({ ...prev, thinkingLevel }))
              }
            />
            <ToolPicker selectedTools={formData.tools} onToggleGroup={toggleGroup} />
            {hasAdvancedTool && (
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div className="space-y-0.5 pe-3">
                  <Label>{t("agent-dialog.yoloLabel")}</Label>
                  <p className="text-xs text-muted-foreground">{t("agent-dialog.yoloHint")}</p>
                </div>
                <Switch
                  checked={formData.yolo}
                  onCheckedChange={(v) => setFormData((prev) => ({ ...prev, yolo: v }))}
                />
              </div>
            )}
            <PathListField
              paths={formData.context}
              onAdd={addContext}
              onRemove={removeContext}
              label={t("agent-dialog.refsLabel")}
              hint={t("agent-dialog.refsHint")}
              placeholder={t("agent-dialog.refsPlaceholder")}
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
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTemplatesOpen(true)}
                  data-prompt-templates-entry
                >
                  {t("agent-dialog.templates.browse")}
                </Button>
              </div>
            </Field>
            <TimePerceptionField
              value={formData.timePerception}
              onChange={(tp) => setFormData((prev) => ({ ...prev, timePerception: tp }))}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </FieldGroup>
        </TabsContent>
        <TabsContent value="personalization" className="flex-1 min-h-0 flex flex-col px-4">
          <FieldGroup className="flex-1 min-h-0 flex flex-col">
            <Field>
              <HintLabel hint={t("agent-dialog.aliasHint")}>{t("agent-dialog.aliasLabel")}</HintLabel>
              <Input
                type="text"
                value={formData.alias ?? ""}
                onChange={(e) => setFormData((prev) => ({ ...prev, alias: e.target.value }))}
                placeholder={t("agent-dialog.aliasPlaceholder")}
              />
            </Field>
            <PathListField
              paths={formData.quickLinks}
              onAdd={addQuickLink}
              onRemove={removeQuickLink}
              label={t("agent-dialog.quickLinksLabel")}
              hint={t("agent-dialog.quickLinksHint")}
              placeholder={t("agent-dialog.quickLinksPlaceholder")}
            />
            <Field className="min-h-0 flex-1">
              <HintLabel hint={t("agent-dialog.themeScopeHint")}>{t("agent-dialog.themeLabel")}</HintLabel>
              <Textarea
                className="flex-1 min-h-40 resize-none font-mono text-xs"
                value={themeContent}
                onChange={(e) => setThemeContent(e.target.value)}
                placeholder={t("agent-dialog.themePlaceholder")}
                spellCheck={false}
              />
            </Field>
          </FieldGroup>
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
      <PromptTemplatesDialog open={templatesOpen} onOpenChange={setTemplatesOpen} />
    </>
  );
}
