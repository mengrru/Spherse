import { create } from "zustand";

interface ProjectData {
  initialMessageBySessionId: Record<string, string>;
  streamingSessionIds: Set<string>;
}

interface ProjectDataStore {
  projects: Record<string, ProjectData>;
  setInitialMessage: (projectId: string, sessionId: string, message: string) => void;
  clearInitialMessage: (projectId: string, sessionId: string) => void;
  consumeInitialMessage: (projectId: string, sessionId: string) => string | undefined;
  setStreaming: (projectId: string, sessionId: string, streaming: boolean) => void;
  clearProjectData: (projectId: string) => void;
}

function createProjectData(): ProjectData {
  return {
    initialMessageBySessionId: {},
    streamingSessionIds: new Set(),
  };
}

function updateProjectData(
  state: ProjectDataStore,
  projectId: string,
  update: (project: ProjectData) => ProjectData,
) {
  return {
    projects: {
      ...state.projects,
      [projectId]: update(state.projects[projectId] ?? createProjectData()),
    },
  };
}

export const useProjectDataStore = create<ProjectDataStore>((set, get) => ({
  projects: {},

  setInitialMessage(projectId, sessionId, message) {
    set((state) => updateProjectData(state, projectId, (project) => ({
      ...project,
      initialMessageBySessionId: { ...project.initialMessageBySessionId, [sessionId]: message },
    })));
  },

  clearInitialMessage(projectId, sessionId) {
    set((state) => updateProjectData(state, projectId, (project) => {
      const { [sessionId]: _removed, ...initialMessageBySessionId } = project.initialMessageBySessionId;
      return { ...project, initialMessageBySessionId };
    }));
  },

  consumeInitialMessage(projectId, sessionId) {
    const message = get().projects[projectId]?.initialMessageBySessionId[sessionId];
    if (message) get().clearInitialMessage(projectId, sessionId);
    return message;
  },

  setStreaming(projectId, sessionId, streaming) {
    set((state) => updateProjectData(state, projectId, (project) => {
      const streamingSessionIds = new Set(project.streamingSessionIds);
      if (streaming) streamingSessionIds.add(sessionId);
      else streamingSessionIds.delete(sessionId);
      return { ...project, streamingSessionIds };
    }));
  },

  clearProjectData(projectId) {
    set((state) => {
      const { [projectId]: _removed, ...projects } = state.projects;
      return { projects };
    });
  },
}));
