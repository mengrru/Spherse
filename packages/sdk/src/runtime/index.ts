import { SDK_VERSION } from "../meta.js";
import { call, fire, installResponseListener } from "./messaging.js";
import {
  getRuntime,
  installRuntimeListener,
  peekRuntime,
  seedFromInjectedGlobal,
} from "./context.js";
import { actions } from "./actions.js";
import { data } from "./data.js";
import { api } from "./api.js";

declare global {
  interface Window {
    spherse?: unknown;
    Spherse?: unknown;
    __SPHERSE_SDK__?: boolean;
  }
}

/**
 * Browser entry — runs once per document as a side effect. esbuild bundles this (and the
 * modules above) into a single IIFE; the host inlines that text into the iframe or serves
 * it as `__spherse-sdk.js`.
 *
 * Guarded by `window.__SPHERSE_SDK__` so a document that loads the bundle twice (e.g. an
 * inline copy plus an external script) stays a no-op on the second load.
 */
if (!window.__SPHERSE_SDK__) {
  window.__SPHERSE_SDK__ = true;

  installResponseListener();
  installRuntimeListener();
  seedFromInjectedGlobal();

  const spherse = {
    version: SDK_VERSION,
    call,
    fire,
    getRuntime,
    get runtime() {
      return peekRuntime();
    },
    ...actions,
    data,
    api,
  };

  window.spherse = spherse;
  if (!window.Spherse) window.Spherse = spherse;
}
