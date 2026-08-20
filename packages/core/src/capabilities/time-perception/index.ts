import type { Capability, StreamDecorator } from "../../kernel/capability.js";
import { isActiveTimePerception, wrapWithTimePerception } from "./time-perception.js";
import type { ContextBlock } from "../../kernel/context-block.js";

const streamDecorator: StreamDecorator = (view) => {
  const config = view.profile.timePerception;
  if (!isActiveTimePerception(config)) return undefined;
  return (base) => wrapWithTimePerception(base, config);
};

export function timePerceptionCapability(): Capability {
  return {
    id: "time-perception",
    streamDecorators: [streamDecorator],
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
