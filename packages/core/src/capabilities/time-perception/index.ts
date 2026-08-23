import type { Capability, PreviewTransform, StreamDecorator } from "../../kernel/capability.js";
import { isActiveTimePerception, injectTimePrefix, wrapWithTimePerception } from "./time-perception.js";
import type { ContextBlock } from "../../kernel/context-block.js";

const streamDecorator: StreamDecorator = (view) => {
  const config = view.profile.timePerception;
  if (!isActiveTimePerception(config)) return undefined;
  return (base) => wrapWithTimePerception(base, config);
};

const previewTransform: PreviewTransform = (view) => {
  const config = view.profile.timePerception;
  if (!isActiveTimePerception(config)) return undefined;
  return (messages) => injectTimePrefix(messages, config);
};

export function timePerceptionCapability(): Capability {
  return {
    id: "time-perception",
    streamDecorators: [streamDecorator],
    previewTransforms: [previewTransform],
    contextBlocks: (view) => {
      const config = view.profile.timePerception;
      if (!isActiveTimePerception(config)) return Promise.resolve([]);
      const block: ContextBlock = {
        kind: "time-perception",
        render: () =>
          "time-perception: enabled\n" +
          "Do not output <time> tags in your replies; they are metadata for your awareness only.",
      };
      return Promise.resolve([block]);
    },
  };
}
