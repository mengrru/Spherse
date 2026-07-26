import { useProjectCtx } from "../../context/project-context";
import { useFloatingContentBrowserStore } from "./store";
import { FloatingContentBrowserContainer } from "./FloatingContentBrowserContainer";

export function FloatingContentBrowserManager() {
  const { projectId } = useProjectCtx();
  const windows = useFloatingContentBrowserStore((s) =>
    projectId ? s.byProject[projectId] : undefined,
  );

  if (!projectId || !windows) return null;

  const entries = Object.values(windows);
  if (entries.length === 0) return null;

  return (
    <>
      {entries.map((w) => (
        <FloatingContentBrowserContainer key={`${projectId}:${w.filePath}`} projectId={projectId} window={w} />
      ))}
    </>
  );
}
