import "./polyfills.js";
import { BrowserRpcApp } from "./rpc-app.js";

interface SharedWorkerScope {
  onconnect: ((ev: MessageEvent) => void) | null;
}

const workerScope = self as unknown as SharedWorkerScope;
let appPromise: Promise<BrowserRpcApp> | null = null;

function getApp(): Promise<BrowserRpcApp> {
  if (!appPromise) {
    appPromise = BrowserRpcApp.create();
  }
  return appPromise;
}

workerScope.onconnect = (ev: MessageEvent) => {
  const port = ev.ports[0];
  if (!port) return;
  void getApp()
    .then((app) => {
      app.attachPort(port);
    })
    .catch((err) => {
      console.error({ err }, "browser rpc app init failed");
      appPromise = null;
    });
};
