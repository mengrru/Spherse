import { call } from "./messaging.js";

type Params = Record<string, unknown>;

/**
 * Per-card key/value store backed by the host. Scopes and persistence are determined
 * server-side (see the `data.*` action handlers). All operations are async.
 */
export const data = {
  get: (params: Params): Promise<unknown> => call("data.get", params),
  set: (params: Params): Promise<unknown> => call("data.set", params),
  delete: (params: Params): Promise<unknown> => call("data.delete", params),
  keys: (params: Params): Promise<unknown> => call("data.keys", params),
  entries: (params: Params): Promise<unknown> => call("data.entries", params),
};
