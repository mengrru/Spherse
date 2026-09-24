import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Capability, StreamDecorator } from "../../kernel/capability.js";
import { WEB_SEARCH_TOOL_NAME, createWebSearchTool, readDeepSeekApiKey } from "../../tools/web-search.js";
import type { WebSearchDeps } from "../../tools/web-search.js";

function hideWebSearchWithoutKey(base: StreamFn, getApiKey: () => string | undefined): StreamFn {
  return (model, context, options) => {
    if (getApiKey() || !context.tools?.some((tool) => tool.name === WEB_SEARCH_TOOL_NAME)) {
      return base(model, context, options);
    }
    const tools = context.tools.filter((tool) => tool.name !== WEB_SEARCH_TOOL_NAME);
    return base(model, { ...context, tools }, options);
  };
}

export function webSearchCapability(deps: WebSearchDeps = {}): Capability {
  const getApiKey = deps.getApiKey ?? readDeepSeekApiKey;
  const streamDecorator: StreamDecorator = (view) => {
    if (!view.profile.tools?.includes(WEB_SEARCH_TOOL_NAME)) return undefined;
    return (base) => hideWebSearchWithoutKey(base, getApiKey);
  };
  return {
    id: "web-search",
    tools: () => [createWebSearchTool({ ...deps, getApiKey })],
    streamDecorators: [streamDecorator],
  };
}
