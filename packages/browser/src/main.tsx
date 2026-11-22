import { createAppRoot } from "@spherse/app/main";
import { setLocalRuntimeTransportFactory } from "@spherse/app/lib/rpc/shared";
import { createBrowserHostBridge } from "./host-bridge-browser.js";
import { RpcSharedWorkerTransport } from "./client/runtime-transport.js";

setLocalRuntimeTransportFactory(() => new RpcSharedWorkerTransport());
const bridge = createBrowserHostBridge();
createAppRoot(bridge);

if (import.meta.env.MODE === "production") {
  void navigator.serviceWorker.register("/sw.js", { scope: "/", type: "module" }).catch(() => {});
} else {
  void navigator.serviceWorker.register("/src/sw/index.ts", { type: "module", scope: "/" }).catch(() => {});
}
