import type { NavigateFunction } from "react-router";
import type { ApiClient } from "../lib/api";

export interface ActionContext {
  navigate: NavigateFunction;
  projectId: string;
  client?: ApiClient;
  source?: MessageEventSource | null;
  requestId?: string;
}

export type ActionHandler<P = Record<string, unknown>> = (
  params: P,
  ctx: ActionContext,
) => void | Promise<void>;
