import { useEffect, type RefObject } from "react";

interface UseDismissableOptions<T extends HTMLElement> {
  ref: RefObject<T | null>;
  onDismiss: () => void;
}

export function useDismissable<T extends HTMLElement>({
  ref,
  onDismiss,
}: UseDismissableOptions<T>) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onDismiss, ref]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onDismiss]);
}
