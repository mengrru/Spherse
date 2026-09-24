import { useEffect } from "react";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";
import { ContentBody } from "./ContentBody";
import { Header } from "./Header";
import { FindScopeRoot } from "./FindScopeRoot";
import { useContentFile } from "./hooks/useContentFile";
import { useContentViewState } from "./hooks/useContentViewState";

interface ReadOnlyContentBrowserProps {
  filePath: string;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onNotFound: () => void;
}

export function ReadOnlyContentBrowser({ filePath, onClose, onOpenFile, onNotFound }: ReadOnlyContentBrowserProps) {
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const file = useContentFile(projectId, client, filePath);
  const view = useContentViewState({ filePath, ...file });

  useEffect(() => {
    if (file.notFound) onNotFound();
  }, [file.notFound, onNotFound]);

  return (
    <FindScopeRoot data-content-browser className="flex h-full flex-col">
      <Header
        filePath={filePath}
        isHtml={view.isHtml}
        htmlView={view.htmlView}
        findable={view.findable}
        onClose={onClose}
        onHtmlViewChange={view.setHtmlView}
        onRefresh={view.refresh}
        onFindToggle={view.toggleFind}
      />
      <ContentBody
        filePath={filePath}
        content={file.content}
        binary={file.binary}
        loading={file.loading}
        error={file.error}
        view={view}
        onOpenFile={onOpenFile}
      />
    </FindScopeRoot>
  );
}
