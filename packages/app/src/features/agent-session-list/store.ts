import { create } from "zustand";

interface AgentSessionListUiState {
  collapsedAgentIdsByProject: Record<string, Set<string>>;
  getCollapsedAgentIds: (projectId: string) => Set<string>;
  toggleAgentCollapsed: (projectId: string, agentId: string) => void;
  setCollapsedAgentIds: (projectId: string, agentIds: Iterable<string>) => void;
  clearProject: (projectId: string) => void;
}

export const useAgentSessionListUiStore = create<AgentSessionListUiState>((set, get) => ({
  collapsedAgentIdsByProject: {},

  getCollapsedAgentIds(projectId) {
    return get().collapsedAgentIdsByProject[projectId] ?? new Set();
  },

  toggleAgentCollapsed(projectId, agentId) {
    set((state) => {
      const current = state.collapsedAgentIdsByProject[projectId] ?? new Set<string>();
      const next = new Set(current);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return {
        collapsedAgentIdsByProject: {
          ...state.collapsedAgentIdsByProject,
          [projectId]: next,
        },
      };
    });
  },

  setCollapsedAgentIds(projectId, agentIds) {
    set((state) => ({
      collapsedAgentIdsByProject: {
        ...state.collapsedAgentIdsByProject,
        [projectId]: new Set(agentIds),
      },
    }));
  },

  clearProject(projectId) {
    set((state) => {
      const { [projectId]: _removed, ...rest } = state.collapsedAgentIdsByProject;
      return { collapsedAgentIdsByProject: rest };
    });
  },
}));
