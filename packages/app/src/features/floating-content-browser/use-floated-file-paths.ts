import { useMemo } from "react";
import { useFloatingContentBrowserStore } from "./store";

const EMPTY_SET: Set<string> = new Set();

export function useFloatedFilePaths(projectId: string): Set<string> {
  const windows = useFloatingContentBrowserStore((s) =>
    projectId ? s.byProject[projectId] : undefined,
  );
  return useMemo(
    () => (windows ? new Set(Object.keys(windows)) : EMPTY_SET),
    [windows],
  );
}
