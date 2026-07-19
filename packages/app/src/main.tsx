import { createRoot, type Root } from "react-dom/client";
import { RouterProvider } from "react-router";
import type { HostBridge } from "./lib/host-bridge";
import { HostBridgeProvider } from "./context/host-bridge-context";
import { router } from "./router";
import "./styles.css";

export function createAppRoot(bridge: HostBridge): Root {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root element not found");
  const root = createRoot(rootEl);
  root.render(
    <HostBridgeProvider bridge={bridge}>
      <RouterProvider router={router} />
    </HostBridgeProvider>,
  );
  return root;
}
