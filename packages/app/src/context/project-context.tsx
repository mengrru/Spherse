import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AppContext } from "./context";

const ProjectContext = createContext<AppContext | null>(null);

interface ProjectProviderProps {
  projectId: string;
  ctx: AppContext;
  children: ReactNode;
}

export function ProjectProvider({ projectId, ctx, children }: ProjectProviderProps) {
  const value = useMemo<AppContext>(() => ctx, [ctx]);
  if (value.projectId !== projectId) {
    throw new Error(
      `ProjectProvider projectId mismatch: prop=${projectId} ctx=${value.projectId}`,
    );
  }
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjectCtx(): AppContext {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProjectCtx must be used within a ProjectProvider");
  }
  return ctx;
}

export function useProjectCtxOrNull(): AppContext | null {
  return useContext(ProjectContext);
}
