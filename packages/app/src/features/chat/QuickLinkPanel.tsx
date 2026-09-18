import { useEffect, useState } from "react";
import { ContentView } from "../content-browser/ContentView";
import { classifyFileKind } from "../content-browser/file-kind";
import { useContentFile } from "../content-browser/hooks/useContentFile";
import { useApiClient } from "../../lib/use-connection";

export type QuickLinkAction = "panel" | "float" | "navigate";

export function resolveQuickLinkAction(isMobile: boolean, floatEnabled: boolean): QuickLinkAction {
  if (isMobile) return "panel";
  if (floatEnabled) return "float";
  return "navigate";
}

interface QuickLinkPanelProps {
  projectId: string;
  path: string;
}

export function QuickLinkPanel({ projectId, path }: QuickLinkPanelProps) {
  const client = useApiClient(projectId);
  const { content, binary, loading, error, dataUpdatedAt } = useContentFile(projectId, client, path);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setRefreshKey((k) => k + 1);
  }, [dataUpdatedAt, path]);

  const { isMarkdown, isHtml, isImage } = classifyFileKind(path);

  return (
    <div
      data-chat-quick-link-panel
      className="absolute inset-x-0 top-full z-30 flex h-[35dvh] animate-[quick-link-unfold_200ms_ease-out] motion-reduce:animate-none flex-col border-b border-border bg-background shadow-lg"
    >
      <ContentView
        filePath={path}
        content={content}
        binary={binary}
        loading={loading}
        error={error}
        isMarkdown={isMarkdown}
        isHtml={isHtml}
        isImage={isImage}
        htmlView="preview"
        isEditing={false}
        editedContent=""
        onEditedContentChange={() => {}}
        refreshKey={refreshKey}
      />
    </div>
  );
}
