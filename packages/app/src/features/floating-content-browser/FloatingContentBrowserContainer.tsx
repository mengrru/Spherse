import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { FloatingFrame } from "../../components/floating-frame";
import { ContentView } from "../content-browser/ContentView";
import { useContentAutoRefresh } from "../content-browser/hooks/useContentAutoRefresh";
import { useContentFile } from "../content-browser/hooks/useContentFile";
import { useApiClient } from "../../lib/use-connection";
import { useFloatingContentBrowserStore, type FloatingContentWindow } from "./store";

interface FloatingContentBrowserContainerProps {
  projectId: string;
  window: FloatingContentWindow;
}

function detectFileKinds(filePath: string) {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const isMarkdown = ext === "md" || ext === "markdown" || filePath.endsWith(".agents.md");
  const isHtml = ext === "html" || ext === "htm";
  const isImage = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"]).has(ext);
  return { isMarkdown, isHtml, isImage };
}

export function FloatingContentBrowserContainer({
  projectId,
  window: floatWindow,
}: FloatingContentBrowserContainerProps) {
  const { filePath, position, size } = floatWindow;
  const navigate = useNavigate();
  const client = useApiClient(projectId);
  const { content, loading, error, reload } = useContentFile(client, filePath);
  const [refreshKey, setRefreshKey] = useState(0);
  const closeFloat = useFloatingContentBrowserStore((s) => s.closeFloat);
  const setPosition = useFloatingContentBrowserStore((s) => s.setPosition);
  const setSize = useFloatingContentBrowserStore((s) => s.setSize);

  useContentAutoRefresh({ projectId, filePath, enabled: true, onReload: () => { reload(); setRefreshKey((k) => k + 1); } });

  useEffect(() => {
    setRefreshKey((k) => k + 1);
  }, [filePath]);

  useEffect(() => {
    if (!loading && content === null && error) {
      closeFloat(projectId, filePath);
    }
  }, [loading, content, error, closeFloat, projectId, filePath]);

  const { isMarkdown, isHtml, isImage } = detectFileKinds(filePath);
  const fileName = filePath.split("/").pop() ?? filePath;

  return createPortal(
    <FloatingFrame
      hookPrefix="content"
      title={fileName}
      position={position}
      size={size}
      onPositionCommit={(pos) => setPosition(projectId, filePath, pos)}
      onSizeCommit={(newSize, pos) => setSize(projectId, filePath, newSize, pos)}
      onClose={() => closeFloat(projectId, filePath)}
      onExpand={() => {
        closeFloat(projectId, filePath);
        navigate(`/project/${projectId}/content?path=${encodeURIComponent(filePath)}`);
      }}
    >
      <div className="flex h-full flex-col">
        <ContentView
          filePath={filePath}
          content={content}
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
    </FloatingFrame>,
    document.body,
  );
}
