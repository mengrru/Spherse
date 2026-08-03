import { call, fire } from "./messaging.js";

type Params = Record<string, unknown>;
type PathLike = string | Params;

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
  createSession: (params: Params): void => fire("createSession", params),
  sendMessage: (params: Params): Promise<unknown> => call("sendMessage", params),
  openFile: (value: PathLike): void => fire("openFile", asPath(value)),
  openExternalLink: (value: PathLike): void => fire("openExternalLink", asUrl(value)),
  floatSession: (value: PathLike): void => fire("floatSession", asSession(value)),
  unfloatSession: (): void => fire("unfloatSession", {}),
  floatContent: (value: PathLike): void => fire("floatContent", asPath(value)),
  unfloatContent: (value: PathLike): void => fire("unfloatContent", asPath(value)),
  emitAgentTriggerEvent: (params: Params): void => fire("emitAgentTriggerEvent", params),
};
