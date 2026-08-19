import { llmAccessPolicy, type AccessPolicy } from "../../access/access-policy.js";
import type { ToolHost } from "../../kernel/ports.js";

export type LlmPolicyProvider = () => AccessPolicy;

export function llmPolicyOf(host: ToolHost): LlmPolicyProvider {
  return () =>
    llmAccessPolicy(
      host.projectStore.getRootPath(),
      host.projectStore.config.getAiAccessSettings().deniedPaths,
      host.pathRules,
    );
}
