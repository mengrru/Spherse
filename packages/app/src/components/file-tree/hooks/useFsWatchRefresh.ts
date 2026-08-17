import { useEffect, useRef } from "react";
import { useBusSubscription } from "../../../hooks/useBusSubscription";
import { useReconnectedSync } from "../../../hooks/useReconnectedSync";

export function useFsWatchRefresh(
  projectId: string,
  refreshRoot: () => Promise<void>,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useBusSubscription(projectId, "fs-watch", () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void refreshRoot();
    }, 300);
  });

  // Connection-recovered compensation: fs-watch events missed while the bus
  // was down are not replayed, so re-pull the tree.
  useReconnectedSync(() => {
    void refreshRoot();
  });

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}
