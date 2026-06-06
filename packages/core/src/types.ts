export const PROJECT_META_DIR = ".spherse";

export interface ProjectConfig {
  name: string;
  created: number;
  defaultModel: string;
  paths: {
    agents: string;
    index: string;
    changelog: string;
  };
  aiAccess?: { deniedPaths: string[] };
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
  providers: Record<string, { apiKey: string } | undefined>;
  defaultModel: string;
  locale: string;
}

export interface ProviderCatalogItem {
  id: string;
  name: string;
  auth: {
    type: "apiKey" | "external" | "unknown";
    envKeys: string[];
  };
  models: ProviderModelItem[];
}

export interface ProviderModelItem {
  id: string;
  name: string;
  provider: string;
  api: string;
  reasoning: boolean;
  input: readonly string[];
  contextWindow?: number;
  maxTokens?: number;
}

export type ProviderCatalog = Record<string, ProviderCatalogItem>;
