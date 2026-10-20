import { getCurrentTools, type Message } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Capability, StreamDecorator } from "../../kernel/capability.js";
import { WEB_SEARCH_TOOL_NAME, createWebSearchTool, readDeepSeekApiKey } from "../../tools/web-search.js";
import type { WebSearchDeps } from "../../tools/web-search.js";

function withoutTool(messages: readonly Message[], name: string): Message[] {
  const tools = getCurrentTools(messages).filter((tool) => tool.name !== name);
  return messages.map((message) => {
    if (message.role !== "system") return message;
    const next: Message = { ...message };
    delete next.toolsAdded;
    delete next.toolsRemoved;
    if (messages[0] === message) {
      next.toolsAdded = tools;
    }
    return next;
  });
}

function hideWebSearchWithoutKey(base: StreamFn, getApiKey: () => string | undefined): StreamFn {
  return (model, context, options) => {
    if (getApiKey() || !getCurrentTools(context.messages).some((tool) => tool.name === WEB_SEARCH_TOOL_NAME)) {
      return base(model, context, options);
    }
    const messages = withoutTool(context.messages, WEB_SEARCH_TOOL_NAME);
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
