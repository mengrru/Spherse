import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useProjectCtx } from "../context/project-context";

const projectNavStacks = new Map<string, string[]>();
const pendingBackTargets = new Map<string, string>();

function isKeyInProject(key: string, projectId: string): boolean {
  const prefix = `/project/${projectId}`;
  return key === prefix || key.startsWith(`${prefix}/`) || key.startsWith(`${prefix}?`);
}

export function projectBackTarget(stack: string[], projectId: string): string {
  if (stack.length <= 1) return `/project/${projectId}`;
  const prev = stack[stack.length - 2];
  if (isKeyInProject(prev, projectId)) return prev;
  return `/project/${projectId}`;
}

export function recordProjectNavLocation(projectId: string, key: string): void {
  let stack = projectNavStacks.get(projectId);
  if (!stack) {
    stack = [];
    projectNavStacks.set(projectId, stack);
  }
  const pendingBack = pendingBackTargets.get(projectId);
  pendingBackTargets.delete(projectId);
  if (pendingBack === key && stack.length > 0 && stack[stack.length - 1] !== key) {
    stack.pop();
  }
  if (stack[stack.length - 1] !== key) {
    stack.push(key);
  }
}

export function useProjectNavHistory(projectId: string): void {
  const location = useLocation();
  useEffect(() => {
    recordProjectNavLocation(projectId, location.pathname + location.search);
  }, [location.pathname, location.search, projectId]);
}

export function getProjectNavStack(projectId: string): readonly string[] {
  return projectNavStacks.get(projectId) ?? [];
}

export function dropFromProjectNavHistory(
  projectId: string,
  match: string | ((key: string) => boolean),
): void {
  const stack = projectNavStacks.get(projectId);
  if (!stack) return;
  const shouldDrop = typeof match === "string" ? (item: string) => item === match : match;
  const next = stack.filter((item) => !shouldDrop(item));
  const deduped = next.filter((item, i) => i === 0 || next[i - 1] !== item);
  projectNavStacks.set(projectId, deduped);
}

export function clearProjectNavHistory(projectId: string): void {
  projectNavStacks.delete(projectId);
  pendingBackTargets.delete(projectId);
}

export function useProjectNavigation(): { back: () => void } {
  const navigate = useNavigate();
  const { projectId } = useProjectCtx();

  const back = useCallback(() => {
    const stack = projectNavStacks.get(projectId);
    if (!stack || stack.length === 0) {
      navigate(`/project/${projectId}`);
      return;
    }
    const target = projectBackTarget(stack, projectId);
    pendingBackTargets.set(projectId, target);
    navigate(target);
  }, [navigate, projectId]);

  return { back };
}
