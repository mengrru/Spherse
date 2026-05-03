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
    <div className="content-browser">
      <div className="content-browser-header">
        <button className="content-back-btn" onClick={onBack}>
          ← 返回
        </button>
        <span className="content-file-path">{filePath}</span>
      </div>
      <div className="content-browser-body">
        {loading && <p className="content-loading">加载中...</p>}
        {error && <p className="content-error">{error}</p>}
        {content && !loading && (
          isMarkdown ? (
            <div className="content-markdown">
              <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
            </div>
          ) : isYaml ? (
            <pre className="content-code">{content}</pre>
          ) : (
            <pre className="content-code">{content}</pre>
          )
        )}
      </div>
    </div>
  );
}
