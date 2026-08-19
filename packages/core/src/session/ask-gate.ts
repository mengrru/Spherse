import type { AskGate, AskOutcome } from "../kernel/gates.js";
import type { SessionControlBus } from "./control-bus.js";

export function createAskGate(bus: SessionControlBus): AskGate {
  return {
    ask(req, timeoutMs): Promise<AskOutcome> {
      return bus.request<AskOutcome>(
        {
          requestId: req.requestId,
          kind: "question",
          toolCallId: req.toolCallId,
          toolName: req.toolName,
          args: req.args,
        },
        timeoutMs,
        { timedOut: true },
      );
    },
  };
}
