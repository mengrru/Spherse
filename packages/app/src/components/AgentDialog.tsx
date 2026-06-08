import { useState, useMemo, useRef, useEffect, type KeyboardEvent } from "react";
import { AGENT_TEMPLATE, AGENT_THEME_TEMPLATE } from "@spherse/presets";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { useI18n } from "@spherse/i18n/react";
import type { ApiClient } from "../lib/api";
import { parseAgentMarkdown, buildAgentMarkdown } from "../lib/agent-markdown";
import type { AgentFormData } from "../lib/agent-markdown";
import { ALL_TOOLS } from "../lib/tool-registry";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { XIcon } from "lucide-react";

const FILE_TREE_EXCLUDE = new Set(["AGENTS.md", "CHANGELOG.md", "changelog.md"]);

type FileSuggestion = { name: string; fullPath: string };

function fuzzyMatch(filePath: string, query: string): boolean {
  const lower = filePath.toLowerCase();
  const parts = query.toLowerCase().split(/\s+/).filter(Boolean);
  return parts.length === 0 || parts.every((seg) => lower.includes(seg));
}

function getErrorMessage(err: unknown, t: (key: string) => string): string {
  return err instanceof Error ? err.message : t("agent-dialog.saveFailed");
}

interface AgentDialogProps {
  mode: "create" | "edit";
  initialContent?: string;
  initialThemeContent?: string;
  client: ApiClient;
  onSubmit: (slug: string, content: string, themeContent: string) => Promise<void>;
  onCancel: () => void;
}

export function AgentDialog({ mode, initialContent, initialThemeContent, client, onSubmit, onCancel }: AgentDialogProps) {
  const { t } = useI18n();
  const raw = initialContent ?? AGENT_TEMPLATE;
  const parsed = useMemo(() => parseAgentMarkdown(raw), [raw]);
  const [formData, setFormData] = useState<AgentFormData>(parsed.formData);
  const [themeContent, setThemeContent] = useState(initialThemeContent ?? AGENT_THEME_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addContext = (path: string) => {
    if (!formData.context.includes(path)) {
      setFormData((prev) => ({ ...prev, context: [...prev.context, path] }));
    }
  };

  const removeContext = (path: string) => {
    setFormData((prev) => ({ ...prev, context: prev.context.filter((c) => c !== path) }));
  };

  const toggleTool = (toolId: string) => {
    setFormData((prev) => ({
      ...prev,
      tools: prev.tools.includes(toolId)
        ? prev.tools.filter((t) => t !== toolId)
        : [...prev.tools, toolId],
    }));
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
              <ToolPicker selectedTools={formData.tools} onToggle={toggleTool} />
              <ContextPathField
                client={client}
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
      </DialogContent>
    </Dialog>
  );
}

function ToolPicker({
  selectedTools,
  onToggle,
}: {
  selectedTools: string[];
  onToggle: (toolId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Field>
      <FieldLabel>{t("agent-dialog.toolsLabel")}</FieldLabel>
      <div className="flex flex-wrap gap-1.5">
        {ALL_TOOLS.map((tool) => {
          const selected = selectedTools.includes(tool.id);
          return (
            <Button
              key={tool.id}
              type="button"
              variant={selected ? "default" : "outline"}
              size="sm"
              onClick={() => onToggle(tool.id)}
            >
              {t(tool.label)}
            </Button>
          );
        })}
      </div>
    </Field>
  );
}

function ContextPathField({
  client,
  contextPaths,
  onAdd,
  onRemove,
}: {
  client: ApiClient;
  contextPaths: string[];
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
}) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [fileTree, setFileTree] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<FileSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    client.getFileTree().then((tree) => {
      setFileTree(tree.filter((f) => !FILE_TREE_EXCLUDE.has(f.split("/").pop() ?? "")));
    }).catch(() => {});
  }, [client]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function hideSuggestions() {
    setShowSuggestions(false);
  }

  function addPath(path: string) {
    onAdd(path);
    setInput("");
    setSuggestions([]);
    setShowSuggestions(false);
  }

  function matchFiles(query: string) {
    if (!query.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const matched = fileTree
      .filter((f) => fuzzyMatch(f, query))
      .filter((f) => !contextPaths.includes(f))
      .map((f) => ({ name: f.split("/").pop() ?? f, fullPath: f }));
    setSuggestions(matched.slice(0, 8));
    setShowSuggestions(matched.length > 0);
  }

  function handleInputChange(value: string) {
    setInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => matchFiles(value), 200);
  }

  function handleInputKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      const path = input.trim();
      if (path && !contextPaths.includes(path)) {
        addPath(path);
      }
    }
  }

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
      <div className="relative">
        <Input
          type="text"
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleInputKeyDown}
          onBlur={() => setTimeout(hideSuggestions, 150)}
          placeholder={t("agent-dialog.refsPlaceholder")}
        />
        {showSuggestions && suggestions.length > 0 && (
          <div ref={suggestionsRef} className="absolute top-full right-0 left-0 z-10 mt-1 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.fullPath}
                type="button"
                className="w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addPath(suggestion.fullPath);
                }}
              >
                {suggestion.fullPath}
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}
