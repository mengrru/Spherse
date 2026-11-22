import type { Capability } from "../../kernel/capability.js";
import { createReadFileTool } from "../../tools/read-file.js";
import { createWriteFileTool } from "../../tools/write-file.js";
import { createEditFileTool } from "../../tools/edit-file.js";
import { createListFilesTool } from "../../tools/list-files.js";
import { createSearchContentTool } from "../../tools/search-content.js";
import { createMoveFileTool } from "../../tools/move-file.js";
import { createCopyFileTool } from "../../tools/copy-file.js";
import { createGenerateImageTool } from "../../tools/generate-image.js";
import { llmPolicyOf } from "../shared/llm-policy.js";

export function fsCapability(): Capability {
  return {
    id: "fs",
    tools: (host) => {
      const { projectRoot, fileWriteMutex } = host;
      const fsPort = host.projectStore.getFsPort();
      const getPolicy = llmPolicyOf(host);
      return [
        createReadFileTool(projectRoot, fsPort, getPolicy),
        createWriteFileTool(projectRoot, fsPort, fileWriteMutex, getPolicy),
        createEditFileTool(projectRoot, fsPort, fileWriteMutex, getPolicy),
        createListFilesTool(projectRoot, fsPort, getPolicy),
        createSearchContentTool(projectRoot, fsPort, getPolicy),
        createMoveFileTool(projectRoot, fsPort, fileWriteMutex, getPolicy),
        createCopyFileTool(projectRoot, fsPort, fileWriteMutex, getPolicy),
        createGenerateImageTool(projectRoot, fsPort),
      ];
    },
  };
}
