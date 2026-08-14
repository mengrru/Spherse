import { call, fire } from "./messaging.js";

type Params = Record<string, unknown>;
type PathLike = string | Params;
export type CreateSessionParams = Params & {
  agentId?: string;
  agentSlug?: string;
  message?: string;
  open?: boolean;
  float?: boolean;
};
export type SendMessageParams = Params & {
  sessionId: string;
  message: string;
  open?: boolean;
  float?: boolean;
};
export interface CreateSessionResult {
  sessionId: string;
}

const asPath = (value: PathLike): Params => (typeof value === "string" ? { path: value } : value);
const asUrl = (value: PathLike): Params => (typeof value === "string" ? { url: value } : value);
const asSession = (value: PathLike): Params =>
  typeof value === "string" ? { sessionId: value } : value;

/**
 * Fire-and-forget host actions. These are UI navigation / lifecycle intents — the host
 * performs them best-effort and never replies. Accept a plain string for the common
 * single-argument case (e.g. `spherse.openFile("/path")`) or a params object.
 */
export const actions = {
  createSession: (params: CreateSessionParams): Promise<CreateSessionResult> =>
    call<CreateSessionResult>("createSession", params),
  sendMessage: (params: SendMessageParams): Promise<void> => call<void>("sendMessage", params),
  openFile: (value: PathLike): void => fire("openFile", asPath(value)),
  openExternalLink: (value: PathLike): void => fire("openExternalLink", asUrl(value)),
  openSession: (value: PathLike): void => fire("openSession", asSession(value)),
  floatSession: (value: PathLike): void => fire("floatSession", asSession(value)),
  unfloatSession: (): void => fire("unfloatSession", {}),
  floatContent: (value: PathLike): void => fire("floatContent", asPath(value)),
  unfloatContent: (value: PathLike): void => fire("unfloatContent", asPath(value)),
  emitAgentTriggerEvent: (params: Params): void => fire("emitAgentTriggerEvent", params),
  toast: (params: Params): void => fire("showToast", params),
};
