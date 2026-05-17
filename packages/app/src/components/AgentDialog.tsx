import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { AGENT_TEMPLATE } from "@spherse/presets";
import type { ApiClient } from "../lib/api";
import { parseAgentMarkdown, buildAgentMarkdown } from "../lib/agent-markdown";
import type { AgentFormData } from "../lib/agent-markdown";
import { ALL_TOOLS } from "../lib/tool-registry";

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
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
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
    clearTimeout(debounceRef.current);
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
    <div className="fixed inset-0 bg-[var(--overlay)] flex items-center justify-center z-[100]" onClick={onCancel}>
      <div className="bg-surface rounded-[10px] w-[600px] max-h-[80vh] flex flex-col shadow-[var(--shadow-dialog)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-light)]">
          <h2 className="font-bold text-accent">
            {mode === "create" ? "创建 Agent" : "编辑 Agent"}
          </h2>
          <button className="bg-none text-lg text-[var(--muted)] p-1 hover:text-[var(--primary)]" onClick={onCancel}>✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--on-muted)] mb-1.5">名称</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-[var(--border-input)] rounded-md text-[13px] outline-none bg-[var(--input-bg)] text-[var(--primary)] focus:border-accent"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Agent 名称"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--on-muted)] mb-1.5">工具权限</label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_TOOLS.map((tool) => {
                const selected = formData.tools.includes(tool.id);
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => toggleTool(tool.id)}
                    className={`px-2.5 py-1 rounded text-[12px] transition-colors border ${
                      selected
                        ? "bg-accent text-white border-accent"
                        : "bg-[var(--muted-bg)] text-[var(--secondary)] border-dashed border-[var(--border)]"
                    }`}
                  >
                    {tool.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--on-muted)] mb-1.5">参考资料</label>
            {formData.context.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {formData.context.map((path) => (
                  <span key={path} className="inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--muted-bg)] rounded text-[11px] text-[var(--primary)]">
                    {path}
                    <button
                      type="button"
                      className="text-[var(--danger)] hover:text-[var(--primary)]"
                      onClick={() => removeContext(path)}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <input
                type="text"
                className="w-full px-3 py-2 border border-[var(--border-input)] rounded-md text-[13px] outline-none bg-[var(--input-bg)] text-[var(--primary)] focus:border-accent"
                value={contextInput}
                onChange={(e) => handleContextInputChange(e.target.value)}
                onKeyDown={handleContextKeyDown}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="输入路径搜索文件，回车添加"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div ref={suggestionsRef} className="absolute left-0 right-0 top-full mt-1 bg-surface border border-[var(--border)] rounded-md shadow-lg z-10 overflow-hidden">
                  {suggestions.map((s) => (
                    <button
                      key={s.fullPath}
                      type="button"
                      className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-[var(--hover)] transition-colors"
                      onMouseDown={(e) => { e.preventDefault(); addContext(s.fullPath); }}
                    >
                      {s.fullPath}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--on-muted)] mb-1.5">提示词</label>
            <textarea
              className="w-full min-h-[160px] p-3 border border-[var(--border-input)] rounded-md font-mono text-[13px] leading-relaxed resize-y outline-none bg-[var(--input-bg)] text-[var(--primary)] focus:border-accent"
              value={formData.systemPrompt}
              onChange={(e) => setFormData((prev) => ({ ...prev, systemPrompt: e.target.value }))}
              spellCheck={false}
            />
          </div>

          {error && <p className="text-danger text-xs">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border-light)]">
          <button className="px-4 py-1.5 bg-[var(--muted-bg)] rounded-[5px] text-[13px] text-[var(--on-muted)] hover:bg-[var(--border)]" onClick={onCancel}>
            取消
          </button>
          <button
            className="px-4 py-1.5 bg-accent text-white rounded-[5px] text-[13px] hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? "保存中..." : mode === "create" ? "创建" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
