import { create } from "zustand";

export interface FloatingChatState {
  sessionId: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

interface ProjectUiState {
  collapsedAgentIds: Set<string>;
  floatingChat?: FloatingChatState;
}

interface ProjectUiStore {
  projects: Record<string, ProjectUiState>;
  getProjectUi: (projectKey: string) => ProjectUiState;
  toggleAgentCollapsed: (projectKey: string, agentId: string) => void;
  setCollapsedAgentIds: (projectKey: string, agentIds: Iterable<string>) => void;
  setFloatingChat: (projectKey: string, state: FloatingChatState | null) => void;
  clearProjectUi: (projectKey: string) => void;
}

const FLOATING_CHAT_STORAGE_PREFIX = "spherse:floating-chat:";

function writeFloatingChat(projectKey: string, state: FloatingChatState | null) {
  if (typeof localStorage === "undefined") return;
  if (state) {
    localStorage.setItem(FLOATING_CHAT_STORAGE_PREFIX + projectKey, JSON.stringify(state));
  } else {
    localStorage.removeItem(FLOATING_CHAT_STORAGE_PREFIX + projectKey);
  }
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

  setFloatingChat(projectKey, state) {
    if (state) {
      writeFloatingChat(projectKey, state);
      set((s) => updateProjectUi(s, projectKey, (project) => {
        const { floatingChat: _, ...rest } = project;
        return { ...rest, floatingChat: state };
      }));
    } else {
      writeFloatingChat(projectKey, null);
      set((s) => updateProjectUi(s, projectKey, (project) => {
        const { floatingChat: _, ...rest } = project;
        return rest;
      }));
    }
  },

  clearProjectUi(projectKey) {
    writeFloatingChat(projectKey, null);
    set((state) => {
      const { [projectKey]: _removed, ...projects } = state.projects;
      return { projects };
    });
  },
}));
