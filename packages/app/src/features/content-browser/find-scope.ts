import { createContext, useCallback, useContext, useEffect, useState, type RefObject } from "react";

interface FindScope {
  root: HTMLElement | null;
}

const scopes: FindScope[] = [];
let activeScope: FindScope | null = null;
let listening = false;

function scopeFor(target: EventTarget | null): FindScope | null {
  if (!(target instanceof Node)) return null;
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    if (scopes[i].root?.contains(target)) return scopes[i];
  }
  return null;
}

function trackInteraction(event: Event) {
  activeScope = scopeFor(event.target);
}

function ensureListening() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("pointerdown", trackInteraction, true);
  document.addEventListener("focusin", trackInteraction, true);
}

function stopListening() {
  if (!listening || scopes.length > 0) return;
  listening = false;
  document.removeEventListener("pointerdown", trackInteraction, true);
  document.removeEventListener("focusin", trackInteraction, true);
}

function registerScope(scope: FindScope): () => void {
  scopes.push(scope);
  ensureListening();
  return () => {
    const index = scopes.indexOf(scope);
    if (index >= 0) scopes.splice(index, 1);
    if (activeScope === scope) activeScope = null;
    stopListening();
  };
}

function isActiveScope(scope: FindScope): boolean {
  if (activeScope) return activeScope === scope;
  const focused = document.activeElement;
  if (focused && focused !== document.body && !scopeFor(focused)) return false;
  return (scopeFor(focused) ?? scopes[scopes.length - 1]) === scope;
}

export const FindScopeRootContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function useFindScope(): { isActive: () => boolean; setOwnRoot: (el: HTMLElement | null) => void } {
  const providedRoot = useContext(FindScopeRootContext);
  const [scope] = useState<FindScope>(() => ({ root: null }));
  const [ownRoot, setOwnRoot] = useState<HTMLElement | null>(null);

  useEffect(() => registerScope(scope), [scope]);

  useEffect(() => {
    scope.root = providedRoot?.current ?? ownRoot;
  }, [providedRoot, ownRoot, scope]);

  const isActive = useCallback(() => isActiveScope(scope), [scope]);
  return { isActive, setOwnRoot };
}
