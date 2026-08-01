import { useNavigate, useSearchParams } from "react-router";
import { useProjectCtx } from "../context/project-context";
import { useProjectNavigation } from "../lib/use-project-navigation";
import { BrowserPageView } from "../features/browser/BrowserPageView";
import { isLoopbackUrl } from "../features/browser/open-external-url";

export function BrowserPage() {
  const { projectId } = useProjectCtx();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { back } = useProjectNavigation();

  const url = searchParams.get("url");

  if (!url || !isLoopbackUrl(url)) {
    navigate(`/project/${projectId}`, { replace: true });
    return null;
  }

  return <BrowserPageView projectId={projectId} url={url} onBack={back} />;
}
