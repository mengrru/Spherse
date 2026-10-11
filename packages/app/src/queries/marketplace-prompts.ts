import { useQuery } from "@tanstack/react-query";
import type { Locale } from "@spherse/i18n";
import type { GlobalApiClient } from "../lib/api";
import { queryClient } from "./client";
import { marketplaceQueryKeys } from "./keys";

export function promptLanguageFromLocale(locale: Locale): string {
  switch (locale) {
    case "zh-CN":
      return "zh-cn";
    case "zh-TW":
      return "zh-tw";
    default:
      return "en-us";
  }
}

export function marketplacePromptsQueryOptions(
  client: GlobalApiClient | null,
  language: string,
  enabled: boolean,
) {
  return {
    queryKey: marketplaceQueryKeys.prompts(language),
    queryFn: () => {
      if (!client) throw new Error("GlobalApiClient unavailable");
      return client.listMarketplacePrompts(language);
    },
    enabled: enabled && client !== null,
    staleTime: 0,
  };
}

export function useMarketplacePrompts(
  client: GlobalApiClient | null,
  language: string,
  enabled: boolean,
) {
  return useQuery(marketplacePromptsQueryOptions(client, language, enabled));
}

export async function invalidateMarketplacePromptQueries(language: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: marketplaceQueryKeys.prompts(language) });
}
