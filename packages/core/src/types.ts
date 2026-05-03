export interface ProjectConfig {
  name: string;
  created: number;
  defaultModel: string;
  paths: {
    agents: string;
    index: string;
    changelog: string;
  };
}

export type AgentType = "creator" | "roleplay" | "scheduler" | string;

export interface AgentDefinition {
  name: string;
  model?: string;
  type: AgentType;
  schedule?: string;
  tools?: string[];
  context?: string[];
  output?: {
    path: string;
    naming: string;
    frontmatter?: Record<string, string>;
  };
  systemPrompt: string;
  filePath: string;
}

export interface SessionInfo {
  id: string;
  agentName: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  status: "active" | "archived";
}
