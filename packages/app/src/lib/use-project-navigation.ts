import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { useProjectCtx } from "../context/project-context";

function isPathInProject(pathname: string, projectId: string): boolean {
  const prefix = `/project/${projectId}`;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function useProjectNavigation(): { back: () => void } {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId } = useProjectCtx();

  const historyRef = useRef<string[]>([]);
  const lastProjectIdRef = useRef(projectId);

  useEffect(() => {
    if (lastProjectIdRef.current !== projectId) {
      historyRef.current = [location.pathname];
      lastProjectIdRef.current = projectId;
      return;
    }
    const stack = historyRef.current;
    if (stack[stack.length - 1] !== location.pathname) {
      stack.push(location.pathname);
    }
  }, [location.pathname, projectId]);

  const back = useCallback(() => {
    const stack = historyRef.current;
    stack.pop();
    const prev = stack[stack.length - 1];
    if (prev && isPathInProject(prev, projectId)) {
      navigate(prev);
    } else {
      navigate(`/project/${projectId}`);
    }
  }, [navigate, projectId]);

  return { back };
}
