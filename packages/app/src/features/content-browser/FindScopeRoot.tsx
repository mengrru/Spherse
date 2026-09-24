import { useRef, type HTMLAttributes, type ReactNode } from "react";
import { FindScopeRootContext } from "./find-scope";

export function FindScopeRoot({ children, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <FindScopeRootContext.Provider value={ref}>
      <div ref={ref} {...props}>{children}</div>
    </FindScopeRootContext.Provider>
  );
}
