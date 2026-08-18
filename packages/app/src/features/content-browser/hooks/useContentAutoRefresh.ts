import { useEffect, useRef } from "react";
import { useBusSubscription } from "../../../hooks/useBusSubscription";
import { useReconnectedSync } from "../../../hooks/useReconnectedSync";

export function useContentAutoRefresh({
  projectId,
  filePath,
  enabled,
  onReload,
}: {
  projectId: string;
  filePath: string;
  enabled: boolean;
  onReload: () => void;
}): void {
  const enabledRef = useRef(enabled);
  const filePathRef = useRef(filePath);
  const onReloadRef = useRef(onReload);

  useEffect(() => {
    enabledRef.current = enabled;
    filePathRef.current = filePath;
    onReloadRef.current = onReload;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useBusSubscription(projectId, "fs-watch", (_type, payload) => {
    if (!enabledRef.current) return;
    const changedPath = (payload as { path?: string } | null)?.path?.replace(/\\/g, "/");
    if (changedPath !== filePathRef.current.replace(/\\/g, "/")) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onReloadRef.current();
    }, 300);
  });

  // Connection-recovered compensation: fs-watch events missed while the bus
  // was down are not replayed, so re-pull the open content.
  useReconnectedSync(() => {
    if (!enabledRef.current) return;
    onReloadRef.current();
  });

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}
