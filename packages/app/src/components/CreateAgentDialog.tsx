import { useState } from "react";

const AGENT_TEMPLATE = `---
name: 新 Agent
model: gemini-2.5-pro
type: creator
tools:
  - read_file
  - write_file
  - list_files
  - search_content
  - append_changelog
context: []
---

# 系统提示

你是一个世界观创作助手。

## 创作风格

- 保持与已有设定的一致性
`;

interface CreateAgentDialogProps {
  onSubmit: (filename: string, content: string) => Promise<void>;
  onCancel: () => void;
}

export function CreateAgentDialog({ onSubmit, onCancel }: CreateAgentDialogProps) {
  const [content, setContent] = useState(AGENT_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extractFilename = (): string | null => {
    const match = content.match(/^name:\s*(.+)$/m);
    if (!match) return null;
    const name = match[1].trim();
    return `${name}.md`;
  };

  const handleSubmit = async () => {
    const filename = extractFilename();
    if (!filename) {
      setError("模板中缺少 name 字段");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(filename, content);
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[var(--overlay)] flex items-center justify-center z-[100]" onClick={onCancel}>
      <div className="bg-surface rounded-[10px] w-[600px] max-h-[80vh] flex flex-col shadow-[var(--shadow-dialog)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-light)]">
          <h2 className="text-base font-semibold text-[var(--primary)]">创建 Agent</h2>
          <button className="bg-none text-lg text-[var(--muted)] p-1 hover:text-[var(--primary)]" onClick={onCancel}>✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-xs text-[var(--muted)] mb-3">
            编辑 frontmatter（name/model/type/tools/context）和正文（系统提示）。
            文件名取自 <code className="bg-[var(--code-bg)] px-1 py-[1px] rounded text-[11px]">name</code> 字段。
          </p>
          <textarea
            className="w-full min-h-[320px] p-3 border border-[var(--border-input)] rounded-md font-mono text-[13px] leading-relaxed resize-y outline-none tab-[2] bg-[var(--input-bg)] text-[var(--primary)] focus:border-accent"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
          />
          {error && <p className="text-danger text-xs mt-2">{error}</p>}
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
            {saving ? "保存中..." : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
