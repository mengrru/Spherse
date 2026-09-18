import { useEffect, useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import { XIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
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
  onClose: () => void;
}

export function QuickLinkPanel({ projectId, path, onClose }: QuickLinkPanelProps) {
  const { t } = useI18n();
  const client = useApiClient(projectId);
  const { content, binary, loading, error, dataUpdatedAt } = useContentFile(projectId, client, path);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setRefreshKey((k) => k + 1);
  }, [dataUpdatedAt, path]);

  const { isMarkdown, isHtml, isImage } = classifyFileKind(path);
  const fileName = path.split("/").filter(Boolean).pop() ?? path;

  return (
    <div
      data-chat-quick-link-panel
      className="absolute inset-x-0 top-full z-30 flex h-[35dvh] animate-in slide-in-from-top duration-200 flex-col border-b border-border bg-background shadow-lg"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1">
        <span className="truncate text-xs font-medium text-muted-foreground" title={path}>
          {fileName}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          onClick={onClose}
          title={t("chat.close")}
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
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
