import type { NavigateFunction } from "react-router";
import type { ApiClient } from "../lib/api";
import type { HostKind } from "../lib/host-bridge";

export interface ActionContext {
  navigate: NavigateFunction;
  projectId: string;
  client?: ApiClient;
  source?: MessageEventSource | null;
  requestId?: string;
  hostKind: HostKind;
  openExternal?: (url: string) => Promise<void>;
}

export type ActionHandler<P = Record<string, unknown>> = (
  params: P,
  ctx: ActionContext,
) => void | Promise<void>;
