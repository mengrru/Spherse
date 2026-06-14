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
  getProjectUi: (projectId: string) => ProjectUiState;
  toggleAgentCollapsed: (projectId: string, agentId: string) => void;
  setCollapsedAgentIds: (projectId: string, agentIds: Iterable<string>) => void;
  setFloatingChat: (projectId: string, state: FloatingChatState | null) => void;
  clearProjectUi: (projectId: string) => void;
}

const FLOATING_CHAT_STORAGE_PREFIX = "spherse:floating-chat:";

function writeFloatingChat(projectId: string, state: FloatingChatState | null) {
  if (typeof localStorage === "undefined") return;
  if (state) {
    localStorage.setItem(FLOATING_CHAT_STORAGE_PREFIX + projectId, JSON.stringify(state));
  } else {
    localStorage.removeItem(FLOATING_CHAT_STORAGE_PREFIX + projectId);
  }
}

function createProjectUi(): ProjectUiState {
  return {
    collapsedAgentIds: new Set(),
  };
}

function updateProjectUi(
  state: ProjectUiStore,
  projectId: string,
  update: (project: ProjectUiState) => ProjectUiState,
) {
  const current = state.projects[projectId] ?? createProjectUi();
  return {
    projects: {
      ...state.projects,
      [projectId]: update(current),
    },
  };
}

export const useProjectUiStore = create<ProjectUiStore>((set, get) => ({
  projects: {},

  getProjectUi(projectId) {
    return get().projects[projectId] ?? createProjectUi();
  },

  toggleAgentCollapsed(projectId, agentId) {
    set((state) => updateProjectUi(state, projectId, (project) => {
      const collapsedAgentIds = new Set(project.collapsedAgentIds);
      if (collapsedAgentIds.has(agentId)) {
        collapsedAgentIds.delete(agentId);
      } else {
        collapsedAgentIds.add(agentId);
      }
      return { ...project, collapsedAgentIds };
    }));
  },

  setCollapsedAgentIds(projectId, agentIds) {
    set((state) => updateProjectUi(state, projectId, (project) => ({
      ...project,
      collapsedAgentIds: new Set(agentIds),
    })));
  },

  setFloatingChat(projectId, state) {
    if (state) {
      writeFloatingChat(projectId, state);
      set((s) => updateProjectUi(s, projectId, (project) => {
        const { floatingChat: _, ...rest } = project;
        return { ...rest, floatingChat: state };
      }));
    } else {
      writeFloatingChat(projectId, null);
      set((s) => updateProjectUi(s, projectId, (project) => {
        const { floatingChat: _, ...rest } = project;
        return rest;
      }));
    }
  },

  clearProjectUi(projectId) {
    writeFloatingChat(projectId, null);
    set((state) => {
      const { [projectId]: _removed, ...projects } = state.projects;
      return { projects };
    });
  },
}));
