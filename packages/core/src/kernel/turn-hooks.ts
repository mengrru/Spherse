import type { Agent } from "@earendil-works/pi-agent-core";
import type { SessionEventType, SessionEventMap } from "../session/events.js";

export interface TurnEventAppender {
  readonly events: readonly { type: string; seq: number; data: unknown }[];
  append<T extends SessionEventType>(type: T, data: SessionEventMap[T]): unknown;
}

export interface TurnHooks {
  beforeTurn?(agent: Agent): Promise<void>;
  afterTurn?(agent: Agent, eventLog: TurnEventAppender): Promise<void>;
  onReload?(): void;
}

export type TurnHooksFactory = (agentId: string, sessionId: string) => TurnHooks;

export function composeTurnHooks(hooks: ReadonlyArray<TurnHooks>): TurnHooks {
  return {
    async beforeTurn(agent) {
      for (const hook of hooks) await hook.beforeTurn?.(agent);
    },
    async afterTurn(agent, eventLog) {
      for (const hook of hooks) {
        if (hook.afterTurn) await hook.afterTurn(agent, eventLog);
      }
    },
    onReload() {
      for (const hook of hooks) hook.onReload?.();
    },
  };
}
