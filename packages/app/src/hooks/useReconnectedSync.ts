import { useEffect, useRef } from "react";
import { useBusStore } from "../stores/bus-store";

/**
 * Subscribe to "connection recovered" signals: the callback runs after every
 * bus WebSocket (re)connection observed while mounted (including the first
 * connection when the hook mounts before the bus connects). Use this to
 * re-read data that may have been missed while the connection was down —
 * the same pattern the chat runtime uses (reconcile history on reconnect).
 *
 * The mount run itself is skipped: a component's own initial load already
 * covers the snapshot at mount time.
 */
export function useReconnectedSync(onResync: () => void): void {
  const resumedAt = useBusStore((s) => s.resumedAt);
  const onResyncRef = useRef(onResync);

  useEffect(() => {
    onResyncRef.current = onResync;
  });

  const prevResumedAtRef = useRef<number | null>(resumedAt);
  useEffect(() => {
    const prev = prevResumedAtRef.current;
    prevResumedAtRef.current = resumedAt;
    if (resumedAt === null || resumedAt === prev) return;
    onResyncRef.current();
  }, [resumedAt]);
}
