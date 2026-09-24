import { createContext, useCallback, useContext, useEffect, useState, type RefObject } from "react";

type FindScope = object;

const scopes: FindScope[] = [];
let activeScope: FindScope | null = null;

function registerScope(scope: FindScope): () => void {
  scopes.push(scope);
  return () => {
    const index = scopes.indexOf(scope);
    if (index >= 0) scopes.splice(index, 1);
    if (activeScope === scope) activeScope = null;
  };
}

function isActiveScope(scope: FindScope): boolean {
  return (activeScope ?? scopes[scopes.length - 1]) === scope;
}

export const FindScopeRootContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function useFindScope(): { isActive: () => boolean; setOwnRoot: (el: HTMLElement | null) => void } {
  const providedRoot = useContext(FindScopeRootContext);
  const [scope] = useState<FindScope>(() => ({}));
  const [ownRoot, setOwnRoot] = useState<HTMLElement | null>(null);

  useEffect(() => registerScope(scope), [scope]);

  useEffect(() => {
    const root = providedRoot?.current ?? ownRoot;
    if (!root) return;
    const activate = () => {
      activeScope = scope;
    };
    root.addEventListener("pointerdown", activate, true);
    root.addEventListener("focusin", activate, true);
    return () => {
      root.removeEventListener("pointerdown", activate, true);
      root.removeEventListener("focusin", activate, true);
    };
  }, [providedRoot, ownRoot, scope]);

  const isActive = useCallback(() => isActiveScope(scope), [scope]);
  return { isActive, setOwnRoot };
}
