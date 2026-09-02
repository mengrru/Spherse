export const PROJECT_META_DIR = ".spherse";

export interface ProjectConfig {
  id: string;
  name: string;
  created: number;
  aiAccess?: { deniedPaths: string[] };
  welcomePage?: { path: string };
}

export interface TimePerceptionConfig {
  enabled: boolean;
  epochMs: number;
  startMs: number;
  flowRate: number;
  timeZone?: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  alias?: string;
  slug: string;
  createdAt?: number;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  tools?: string[];
  context?: string[];
  output?: {
    path: string;
    naming: string;
    frontmatter?: Record<string, string>;
  };
  timePerception?: TimePerceptionConfig;
  yolo?: boolean;
  systemPrompt: string;
  filePath: string;
}

export interface SkillDefinition {
  name: string;
  description: string;
  instructions: string;
  filePath: string;
  source: "builtin" | "project";
  files: string[];
  version?: string;
}

export type TriggerType = "time" | "event";

export interface TriggerEntry {
  id: string;
  name?: string;
  enabled: boolean;
  type: TriggerType;
  cron?: string;
  eventName?: string;
  mode: "new_session" | "existing_session" | "reusable_session";
  targetSessionId?: string;
  boundSessionId?: string;
  message: string;
  notify: boolean;
  notificationMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TriggerLogEntry {
  triggerId: string;
  triggerName?: string;
  agentName?: string;
  eventName?: string;
  sessionId: string;
  triggeredAt: number;
  completedAt?: number;
  status: "running" | "success" | "failed";
  error?: string;
}

export interface SessionInfo {
  id: string;
  agentId: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  status: "active" | "archived";
  source?: "manual" | "triggered";
}

export interface ProviderCredentials {
  apiKey?: string;
}

export interface SamplingParams {
  temperature?: number;
  topP?: number;
}

export type ThinkingLevel = "off" | "low" | "medium" | "high";

export interface ModelGroupSettings {
  defaultModel: string;
  providers: Record<string, ProviderCredentials>;
  sampling?: SamplingParams;
  thinkingLevel?: ThinkingLevel;
}

export type ThemeMode = "light" | "dark" | "system";

export type MobileTunnelMode = "quick" | "manual";

export interface MobileAccessSettings {
  enabled: boolean;
  token?: string;
  mode?: MobileTunnelMode;
  publicDomain?: string;
}

export interface AppSettings {
  locale: string;
  models: {
    text: ModelGroupSettings;
    image: ModelGroupSettings;
  };
  customProviders?: CustomProviderDef[];
  debugToolsEnabled?: boolean;
  theme?: ThemeMode;
  mobileAccess?: MobileAccessSettings;
}

export interface ProviderCatalogItem {
  id: string;
  name: string;
  auth: {
    type: "apiKey" | "external" | "unknown";
    envKeys: string[];
  };
  models: ProviderModelItem[];
  custom?: boolean;
  keyless?: boolean;
  baseUrl?: string;
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

export interface CustomProviderDef {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  keyless: boolean;
  contextWindow?: number;
  maxTokens?: number;
}
