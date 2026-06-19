import { create } from "zustand";

export interface FloatingChatState {
  sessionId: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

interface FloatingChatStore {
  byProject: Record<string, FloatingChatState>;
  getFloatingChat: (projectId: string) => FloatingChatState | undefined;
  setFloatingChat: (projectId: string, state: FloatingChatState | null) => void;
  clearProject: (projectId: string) => void;
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

export const useFloatingChatStore = create<FloatingChatStore>((set, get) => ({
  byProject: {},

  getFloatingChat(projectId) {
    return get().byProject[projectId];
  },

  setFloatingChat(projectId, state) {
    if (state) {
      writeFloatingChat(projectId, state);
      set((s) => ({
        byProject: { ...s.byProject, [projectId]: state },
      }));
    } else {
      writeFloatingChat(projectId, null);
      set((s) => {
        const { [projectId]: _removed, ...rest } = s.byProject;
        return { byProject: rest };
      });
    }
  },

  clearProject(projectId) {
    writeFloatingChat(projectId, null);
    set((s) => {
      const { [projectId]: _removed, ...rest } = s.byProject;
      return { byProject: rest };
    });
  },
}));
