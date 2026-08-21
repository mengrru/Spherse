import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Capability } from "../../kernel/capability.js";
import type { DataStore } from "./types.js";
import { createDataStore } from "./data-store.js";
import { createMutateDataTool, createQueryDataTool, createReadDataTool } from "./tools.js";
import { llmPolicyOf } from "../shared/llm-policy.js";

export function dataCapability(shared?: DataStore): Capability {
  let own: DataStore | null = null;
  return {
    id: "data",
    tools: (host) => {
      const store = shared ?? (own ??= createDataStore({
        projectRoot: host.projectRoot,
        fileWriteMutex: host.fileWriteMutex,
        logger: host.logger,
      }));
      const getPolicy = llmPolicyOf(host);
      return [
        createReadDataTool(store, getPolicy),
        createQueryDataTool(store, getPolicy),
        createMutateDataTool(store, getPolicy),
      ] satisfies AgentTool[];
    },
  };
}
