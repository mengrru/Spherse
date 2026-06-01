export interface ProviderConfig {
  name: string;
  envKey: string;
  models: readonly string[];
}

export interface AppSettings {
  providers?: Record<string, { apiKey?: string } | undefined>;
  defaultModel?: string;
}

export interface SettingsApi {
  getSettings: () => Promise<AppSettings | null>;
  saveSettings: (settings: AppSettings) => Promise<{ success: boolean }>;
  getSupportedProviders: () => Promise<Record<string, ProviderConfig>>;
}

export const MODEL_PROVIDER_IDS = ["deepseek", "zai"] as const;

export const FALLBACK_MODEL_PROVIDERS: Record<(typeof MODEL_PROVIDER_IDS)[number], ProviderConfig> = {
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
};
