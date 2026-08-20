import { llmAccessPolicy, type AccessPolicyProvider } from "../../access/access-policy.js";
import type { ToolHost } from "../../kernel/ports.js";

export function llmPolicyOf(host: ToolHost): AccessPolicyProvider {
  return () =>
    llmAccessPolicy(
      host.projectStore.getRootPath(),
      host.projectStore.config.getAiAccessSettings().deniedPaths,
      host.pathRules,
    );
}
