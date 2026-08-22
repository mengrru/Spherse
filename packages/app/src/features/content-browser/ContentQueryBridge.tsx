import { useEffect, useRef } from "react";
import { useBusSubscription } from "../../hooks/useBusSubscription";
import { useReconnectedSync } from "../../hooks/useReconnectedSync";
import { invalidateProjectFileQueries } from "../../queries/content";
import { useProjectCtx } from "../../context/project-context";

export function ContentQueryBridge() {
  const { projectId } = useProjectCtx();
  const changedPathsRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useBusSubscription(projectId, "fs-watch", (_type, payload) => {
    const changedPath = (payload as { path?: string } | null)?.path;
    if (changedPath) changedPathsRef.current.add(changedPath);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const changedPaths = [...changedPathsRef.current];
      changedPathsRef.current.clear();
      if (changedPaths.length === 0) {
        void invalidateProjectFileQueries(projectId);
      } else {
        for (const path of changedPaths) void invalidateProjectFileQueries(projectId, path);
      }
    }, 300);
  });

  useReconnectedSync(() => {
    void invalidateProjectFileQueries(projectId);
  });

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    changedPathsRef.current.clear();
  }, [projectId]);

  return null;
}
