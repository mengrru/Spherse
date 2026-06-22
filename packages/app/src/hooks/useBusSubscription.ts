import { useEffect, useRef } from "react";
import { useBusStore, type BusChannel, type BusHandler } from "../stores/bus-store";

export function useBusSubscription(
  projectId: string,
  channel: BusChannel,
  handler: BusHandler,
): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const store = useBusStore.getState();
    const stable: BusHandler = (type, payload) => handlerRef.current(type, payload);
    store.addHandler(projectId, channel, stable);
    return () => {
      store.removeHandler(projectId, channel, stable);
    };
  }, [projectId, channel]);
}
