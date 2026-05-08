import { useState, useEffect } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ApiClient } from "../lib/api";

interface ContentBrowserProps {
  client: ApiClient;
  filePath: string;
  onBack: () => void;
}

export function ContentBrowser({ client, filePath, onBack }: ContentBrowserProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    client
      .getContent(filePath)
      .then((data) => {
        if (data) {
          setContent(data.content);
        } else {
          setError("File not found");
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filePath, client]);

  const isMarkdown =
    filePath.endsWith(".md") ||
    filePath.endsWith(".markdown") ||
    filePath.endsWith(".agents.md");
  const isYaml = filePath.endsWith(".yaml") || filePath.endsWith(".yml");

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-surface">
        <button className="px-3 py-1 bg-[var(--muted-bg)] rounded text-sm text-[var(--primary)] hover:bg-[var(--hover-strong)]" onClick={onBack}>
          ← 返回
        </button>
        <span className="text-sm text-[var(--secondary)] font-mono">{filePath}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {loading && <p className="text-[var(--muted)] text-center p-8">加载中...</p>}
        {error && <p className="text-danger text-center p-8">{error}</p>}
        {content && !loading && (
          isMarkdown ? (
            <div className="bg-surface p-6 rounded-lg border border-[var(--border)] leading-relaxed prose-content">
              <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
            </div>
          ) : isYaml ? (
            <pre className="bg-surface p-4 rounded-lg border border-[var(--border)] font-mono text-sm whitespace-pre-wrap leading-relaxed">{content}</pre>
          ) : (
            <pre className="bg-surface p-4 rounded-lg border border-[var(--border)] font-mono text-sm whitespace-pre-wrap leading-relaxed">{content}</pre>
          )
        )}
      </div>
    </div>
  );
}
