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
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>创建 Agent</h2>
          <button className="dialog-close" onClick={onCancel}>✕</button>
        </div>
        <div className="dialog-body">
          <p className="dialog-hint">
            编辑 frontmatter（name/model/type/tools/context）和正文（系统提示）。
            文件名取自 <code>name</code> 字段。
          </p>
          <textarea
            className="dialog-editor"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
          />
          {error && <p className="dialog-error">{error}</p>}
        </div>
        <div className="dialog-footer">
          <button className="dialog-btn-cancel" onClick={onCancel}>
            取消
          </button>
          <button
            className="dialog-btn-submit"
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
