import { create } from "zustand";

interface ProjectUiState {
  collapsedAgentIds: Set<string>;
}

interface ProjectUiStore {
  projects: Record<string, ProjectUiState>;
  getProjectUi: (projectKey: string) => ProjectUiState;
  toggleAgentCollapsed: (projectKey: string, agentId: string) => void;
  setCollapsedAgentIds: (projectKey: string, agentIds: Iterable<string>) => void;
  clearProjectUi: (projectKey: string) => void;
}

function createProjectUi(): ProjectUiState {
  return {
    collapsedAgentIds: new Set(),
  };
}

function updateProjectUi(
  state: ProjectUiStore,
  projectKey: string,
  update: (project: ProjectUiState) => ProjectUiState,
) {
  const current = state.projects[projectKey] ?? createProjectUi();
  return {
    projects: {
      ...state.projects,
      [projectKey]: update(current),
    },
  };
}

export const useProjectUiStore = create<ProjectUiStore>((set, get) => ({
  projects: {},

  getProjectUi(projectKey) {
    return get().projects[projectKey] ?? createProjectUi();
  },

  toggleAgentCollapsed(projectKey, agentId) {
    set((state) => updateProjectUi(state, projectKey, (project) => {
      const collapsedAgentIds = new Set(project.collapsedAgentIds);
      if (collapsedAgentIds.has(agentId)) {
        collapsedAgentIds.delete(agentId);
      } else {
        collapsedAgentIds.add(agentId);
      }
      return { ...project, collapsedAgentIds };
    }));
  },

  setCollapsedAgentIds(projectKey, agentIds) {
    set((state) => updateProjectUi(state, projectKey, (project) => ({
      ...project,
      collapsedAgentIds: new Set(agentIds),
    })));
  },

  clearProjectUi(projectKey) {
    set((state) => {
      const { [projectKey]: _removed, ...projects } = state.projects;
      return { projects };
    });
  },
}));
