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

export interface AgentProfile {
  id: string;
  name: string;
  model?: string;
  type: string;
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

export interface SkillDefinition {
  name: string;
  description: string;
  instructions: string;
  filePath: string;
}

export interface SessionInfo {
  id: string;
  agentId: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  status: "active" | "archived";
}

export interface AppSettings {
  providers: {
    deepseek?: { apiKey: string };
    zai?: { apiKey: string };
  };
  defaultModel: string;
}

export const SUPPORTED_PROVIDERS = {
  deepseek: {
    name: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  },
  zai: {
    name: "z.ai",
    envKey: "ZAI_API_KEY",
    models: ["glm-4.5-air", "glm-4.7", "glm-5-turbo", "glm-5.1", "glm-5v-turbo"],
  },
} as const;

export type SupportedProviderId = keyof typeof SUPPORTED_PROVIDERS;
