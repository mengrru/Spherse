import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useProjectCtx } from "../context/project-context";

const projectNavStacks = new Map<string, string[]>();

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

export function useProjectNavHistory(projectId: string): void {
  const location = useLocation();
  useEffect(() => {
    const key = location.pathname + location.search;
    let stack = projectNavStacks.get(projectId);
    if (!stack) {
      stack = [];
      projectNavStacks.set(projectId, stack);
    }
    if (stack[stack.length - 1] !== key) {
      stack.push(key);
    }
  }, [location.pathname, location.search, projectId]);
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
    stack.pop();
    navigate(target);
  }, [navigate, projectId]);

  return { back };
}
