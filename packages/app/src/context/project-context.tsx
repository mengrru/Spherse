import { createContext, useContext, useMemo, type ReactNode } from "react";

export interface ProjectCtx {
  projectId: string;
  projectRoot: string;
}

const ProjectContext = createContext<ProjectCtx | null>(null);

interface ProjectProviderProps {
  projectId: string;
  projectRoot: string;
  children: ReactNode;
}

export function ProjectProvider({ projectId, projectRoot, children }: ProjectProviderProps) {
  const value = useMemo<ProjectCtx>(
    () => ({ projectId, projectRoot }),
    [projectId, projectRoot],
  );
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjectCtx(): ProjectCtx {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProjectCtx must be used within a ProjectProvider");
  }
  return ctx;
}

export function useProjectCtxOrNull(): ProjectCtx | null {
  return useContext(ProjectContext);
}
