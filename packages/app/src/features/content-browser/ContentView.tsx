import type { RefObject } from "react";
import type { ApiClient } from "../../lib/api";
import { MarkdownContent } from "../../components/MarkdownContent";
import { Textarea } from "../../components/ui/textarea";

interface ContentViewProps {
  client: ApiClient;
  filePath: string;
  content: string | null;
  contentRef: RefObject<HTMLDivElement | null>;
  loading: boolean;
  error: string | null;
  isMarkdown: boolean;
  isHtml: boolean;
  htmlView: "preview" | "source";
  isEditing: boolean;
  editedContent: string;
  onEditedContentChange: (content: string) => void;
}

export function ContentView({
  client,
  filePath,
  content,
  contentRef,
  loading,
  error,
  isMarkdown,
  isHtml,
  htmlView,
  isEditing,
  editedContent,
  onEditedContentChange,
}: ContentViewProps) {
  if (isHtml && htmlView === "preview" && !isEditing && !loading && !error) {
    return (
      <iframe
        src={client.getPreviewUrl(filePath)}
        className="flex-1 w-full border-0"
        title="HTML Preview"
      />
    );
  }

  if (isEditing) {
    return (
      <Textarea
        className="min-h-0 flex-1 resize-none rounded-none border-none bg-background p-4 font-mono text-sm leading-relaxed shadow-none focus-visible:ring-0"
        value={editedContent}
        onChange={(event) => onEditedContentChange(event.target.value)}
        spellCheck={false}
      />
    );
  }

  return (
    <div ref={contentRef} className="flex-1 overflow-y-auto p-4">
      {loading && <p className="p-8 text-center text-muted-foreground">加载中...</p>}
      {error && <p className="p-8 text-center text-destructive">{error}</p>}
      {content && !loading && (
        isMarkdown ? (
          <div className="rounded-lg border border-border bg-card p-6 text-card-foreground">
            <MarkdownContent variant="document">{content}</MarkdownContent>
          </div>
        ) : (
          <pre className="rounded-lg border border-border bg-card p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap">{content}</pre>
        )
      )}
    </div>
  );
}
