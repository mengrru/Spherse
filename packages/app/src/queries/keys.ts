export const projectQueryKeys = {
  all: (projectId: string) => ["projects", projectId] as const,
  agents: (projectId: string) => ["projects", projectId, "agents"] as const,
  sessions: (projectId: string) => ["projects", projectId, "sessions"] as const,
  session: (projectId: string, sessionId: string) =>
    ["projects", projectId, "session", sessionId] as const,
  content: (projectId: string, filePath: string) =>
    ["projects", projectId, "content", filePath] as const,
  directories: (projectId: string) => ["projects", projectId, "directories"] as const,
  directory: (projectId: string, dirPath: string) =>
    ["projects", projectId, "directories", dirPath] as const,
  fileTree: (projectId: string) => ["projects", projectId, "file-tree"] as const,
  skills: (projectId: string) => ["projects", projectId, "skills"] as const,
  marketplaceSkills: (projectId: string) =>
    ["projects", projectId, "marketplace", "skills"] as const,
  welcomePage: (projectId: string) => ["projects", projectId, "welcome-page"] as const,
};
