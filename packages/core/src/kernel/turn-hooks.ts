import type { Agent } from "@earendil-works/pi-agent-core";
import type { MessageLog } from "../kernel/message-log.js";

export interface TurnHooks {
  beforeTurn?(agent: Agent): Promise<void>;
  afterTurn?(agent: Agent, log: MessageLog): Promise<MessageLog>;
  onReload?(): void;
}

export type TurnHooksFactory = (agentId: string, sessionId: string) => TurnHooks;

export function composeTurnHooks(hooks: ReadonlyArray<TurnHooks>): TurnHooks {
  return {
    async beforeTurn(agent) {
      for (const hook of hooks) await hook.beforeTurn?.(agent);
    },
    async afterTurn(agent, log) {
      let current = log;
      for (const hook of hooks) {
        if (hook.afterTurn) current = await hook.afterTurn(agent, current);
      }
      return current;
    },
    onReload() {
      for (const hook of hooks) hook.onReload?.();
    },
  };
}
