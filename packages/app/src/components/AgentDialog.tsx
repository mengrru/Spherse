import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { AGENT_TEMPLATE } from "@spherse/presets";
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

function fuzzyMatch(filePath: string, query: string): boolean {
  const lower = filePath.toLowerCase();
  const parts = query.toLowerCase().split(/\s+/).filter(Boolean);
  return parts.length === 0 || parts.every((seg) => lower.includes(seg));
}

interface AgentDialogProps {
  mode: "create" | "edit";
  initialContent?: string;
  client: ApiClient;
  onSubmit: (filename: string, content: string) => Promise<void>;
  onCancel: () => void;
}

export function AgentDialog({ mode, initialContent, client, onSubmit, onCancel }: AgentDialogProps) {
  const raw = initialContent ?? AGENT_TEMPLATE;
  const parsed = useMemo(() => parseAgentMarkdown(raw), [raw]);
  const [formData, setFormData] = useState<AgentFormData>(parsed.formData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextInput, setContextInput] = useState("");
  const [suggestions, setSuggestions] = useState<{ name: string; fullPath: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fileTree, setFileTree] = useState<string[]>([]);

  useEffect(() => {
    client.getFileTree().then((tree) => {
      setFileTree(tree.filter((f) => !FILE_TREE_EXCLUDE.has(f.split("/").pop() ?? "")));
    }).catch(() => {});
  }, [client]);

  function matchFiles(input: string) {
    if (!input.trim()) { setSuggestions([]); setShowSuggestions(false); return; }
    const matched = fileTree
      .filter((f) => fuzzyMatch(f, input))
      .filter((f) => !formData.context.includes(f))
      .map((f) => ({ name: f.split("/").pop() ?? f, fullPath: f }));
    setSuggestions(matched.slice(0, 8));
    setShowSuggestions(matched.length > 0);
  }

  const handleContextInputChange = (value: string) => {
    setContextInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => matchFiles(value), 200);
  };

  const addContext = (path: string) => {
    if (!formData.context.includes(path)) {
      setFormData((prev) => ({ ...prev, context: [...prev.context, path] }));
    }
    setContextInput("");
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const removeContext = (path: string) => {
    setFormData((prev) => ({ ...prev, context: prev.context.filter((c) => c !== path) }));
  };

  const handleContextKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (contextInput.trim() && !formData.context.includes(contextInput.trim())) {
        addContext(contextInput.trim());
      }
    }
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
    if (!formData.name.trim()) { setError("请输入 Agent 名称"); return; }
    setSaving(true); setError(null);
    const content = buildAgentMarkdown(formData, parsed.extraFrontmatter, mode === "create");
    const filename = `${formData.name.trim()}.md`;
    try { await onSubmit(filename, content); }
    catch (err: any) { setError(err.message); setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-h-[80vh] sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "创建 Agent" : "编辑 Agent"}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FieldGroup>
            <Field>
              <FieldLabel>名称</FieldLabel>
              <Input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Agent 名称"
              />
            </Field>

            <Field>
              <FieldLabel>工具权限</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                {ALL_TOOLS.map((tool) => {
                  const selected = formData.tools.includes(tool.id);
                  return (
                    <Button
                      key={tool.id}
                      type="button"
                      variant={selected ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleTool(tool.id)}
                    >
                      {tool.label}
                    </Button>
                  );
                })}
              </div>
            </Field>

            <Field>
              <FieldLabel>参考资料</FieldLabel>
              {formData.context.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {formData.context.map((path) => (
                    <Badge key={path} variant="secondary" className="gap-1">
                      {path}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="-mr-1 size-4"
                        onClick={() => removeContext(path)}
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
                  value={contextInput}
                  onChange={(e) => handleContextInputChange(e.target.value)}
                  onKeyDown={handleContextKeyDown}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  placeholder="输入路径搜索文件，回车添加"
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div ref={suggestionsRef} className="absolute top-full right-0 left-0 z-10 mt-1 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
                    {suggestions.map((s) => (
                      <button
                        key={s.fullPath}
                        type="button"
                        className="w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                        onMouseDown={(e) => { e.preventDefault(); addContext(s.fullPath); }}
                      >
                        {s.fullPath}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>

            <Field>
              <FieldLabel>提示词</FieldLabel>
              <Textarea
                className="min-h-40 resize-y font-mono"
                value={formData.systemPrompt}
                onChange={(e) => setFormData((prev) => ({ ...prev, systemPrompt: e.target.value }))}
                spellCheck={false}
              />
            </Field>

            {error && <p className="text-xs text-destructive">{error}</p>}
          </FieldGroup>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? "保存中..." : mode === "create" ? "创建" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
