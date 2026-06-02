import { useEffect, useRef } from "react";
import type { ApiClient } from "../../../lib/api";

export function useFsWatchRefresh(
  client: ApiClient,
  refreshRoot: () => Promise<void>,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ws = client.createFsWatchWebSocket(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        refreshRoot();
      }, 300);
    });
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      ws.close();
    };
  }, [client, refreshRoot]);
}
