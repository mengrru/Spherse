import { useEffect, useRef } from "react";
import { useBusSubscription } from "../../../hooks/useBusSubscription";

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

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}
