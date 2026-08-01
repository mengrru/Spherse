import { useMemo } from "react";
import { useBrowserStore } from "./store";

const EMPTY_SET: Set<string> = new Set();

export function useBrowsedUrls(projectId: string): Set<string> {
  const windows = useBrowserStore((s) => (projectId ? s.byProject[projectId] : undefined));
  return useMemo(
    () => (windows ? new Set(Object.keys(windows)) : EMPTY_SET),
    [windows],
  );
}
