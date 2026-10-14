import type { StreamFn } from "@earendil-works/pi-agent-core";
import { getCurrentTools } from "@earendil-works/pi-ai";
import type { Capability, StreamDecorator } from "../../kernel/capability.js";
import { WEB_SEARCH_TOOL_NAME, createWebSearchTool, readDeepSeekApiKey } from "../../tools/web-search.js";
import type { WebSearchDeps } from "../../tools/web-search.js";

function hideWebSearchWithoutKey(base: StreamFn, getApiKey: () => string | undefined): StreamFn {
  return (model, context, options) => {
    if (getApiKey() || !getCurrentTools(context.messages).some((tool) => tool.name === WEB_SEARCH_TOOL_NAME)) {
      return base(model, context, options);
    }
    const messages = context.messages.map((message) => message.role === "system"
      ? {
          ...message,
          toolsAdded: message.toolsAdded?.filter((tool) => tool.name !== WEB_SEARCH_TOOL_NAME),
        }
      : message);
    return base(model, { ...context, messages }, options);
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
