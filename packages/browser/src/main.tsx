import { createAppRoot } from "@spherse/app/main";
import { setLocalRuntimeTransportFactory } from "@spherse/app/lib/rpc/shared";
import { createBrowserHostBridge } from "./host-bridge-browser.js";
import { RpcSharedWorkerTransport } from "./client/runtime-transport.js";

setLocalRuntimeTransportFactory(() => new RpcSharedWorkerTransport());
const bridge = createBrowserHostBridge();
createAppRoot(bridge);
