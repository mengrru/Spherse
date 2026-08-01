import { useProjectCtx } from "../../context/project-context";
import { useBrowserStore } from "./store";
import { FloatingBrowserContainer } from "./FloatingBrowserContainer";

export function BrowserManager() {
  const { projectId } = useProjectCtx();
  const windows = useBrowserStore((s) => (projectId ? s.byProject[projectId] : undefined));

  if (!projectId || !windows) return null;

  const entries = Object.values(windows);
  if (entries.length === 0) return null;

  return (
    <>
      {entries.map((w) => (
        <FloatingBrowserContainer key={`${projectId}:${w.url}`} projectId={projectId} window={w} />
      ))}
    </>
  );
}
