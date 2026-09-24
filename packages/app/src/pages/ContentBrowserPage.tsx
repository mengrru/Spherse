import { useNavigate, useSearchParams } from "react-router";
import { ContentBrowser } from "../features/content-browser";
import { useSplitPaneAvailable, useOpenSplit } from "../features/split-pane";
import { useCloseActiveTab } from "../features/tabs";
import { useProjectCtx } from "../context/project-context";
import { useProjectNavigation } from "../lib/use-project-navigation";

export function ContentBrowserPage() {
  const { projectId } = useProjectCtx();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { back } = useProjectNavigation();
  const closeActiveTab = useCloseActiveTab();
  const splitAvailable = useSplitPaneAvailable();
  const openSplit = useOpenSplit();

  const filePath = searchParams.get("path");

  if (!filePath) {
    navigate(`/project/${projectId}`, { replace: true });
    return null;
  }

  return (
    <ContentBrowser
      key={filePath}
      filePath={filePath}
      onBack={back}
      onClose={() => closeActiveTab(() => navigate(`/project/${projectId}`, { replace: true }))}
      onSplit={splitAvailable ? () => openSplit({ kind: "file", path: filePath }) : undefined}
    />
  );
}
