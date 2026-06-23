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

  const prevPathnameRef = useRef("");
  const currPathnameRef = useRef(location.pathname);

  useEffect(() => {
    prevPathnameRef.current = currPathnameRef.current;
    currPathnameRef.current = location.pathname;
  }, [location.pathname]);

  const back = useCallback(() => {
    if (isPathInProject(prevPathnameRef.current, projectId)) {
      navigate(-1);
    } else {
      navigate(`/project/${projectId}`);
    }
  }, [navigate, projectId]);

  return { back };
}
