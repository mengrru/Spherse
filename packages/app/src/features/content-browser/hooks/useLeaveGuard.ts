import { useCallback, useEffect, useRef } from "react";
import { useBlocker, type BlockerFunction } from "react-router";
import { readNavState } from "../../../lib/nav-state";

export function useLeaveGuard(isDirty: boolean) {
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation, historyAction }) => {
    if (!isDirty) return false;
    if (historyAction !== "POP" && readNavState(nextLocation.state).skipLeaveGuard) return false;
    return currentLocation.pathname !== nextLocation.pathname
      || currentLocation.search !== nextLocation.search;
  }, [isDirty]);
  const blocker = useBlocker(shouldBlock);
  const settledRef = useRef(false);

  const open = blocker.state === "blocked";
  useEffect(() => {
    if (open) settledRef.current = false;
  }, [open]);

  const confirm = useCallback(() => {
    if (blocker.state !== "blocked" || settledRef.current) return;
    settledRef.current = true;
    blocker.proceed();
  }, [blocker]);

  const onOpenChange = useCallback((next: boolean) => {
    if (next || blocker.state !== "blocked" || settledRef.current) return;
    settledRef.current = true;
    blocker.reset();
  }, [blocker]);

  return { open, confirm, onOpenChange };
}
