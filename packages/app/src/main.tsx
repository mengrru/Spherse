import { createRoot, type Root } from "react-dom/client";
import { RouterProvider } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import type { HostBridge } from "./lib/host-bridge";
import { HostBridgeProvider } from "./context/host-bridge-context";
import { router } from "./router";
import { queryClient } from "./queries/client";
import "./styles.css";

function preventFileDragNavigation(): void {
  const handler = (e: DragEvent) => {
    if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
  };
  window.addEventListener("dragover", handler);
  window.addEventListener("drop", handler);
}

export function createAppRoot(bridge: HostBridge): Root {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root element not found");
  preventFileDragNavigation();
  const root = createRoot(rootEl);
  root.render(
    <QueryClientProvider client={queryClient}>
      <HostBridgeProvider bridge={bridge}>
        <RouterProvider router={router} />
      </HostBridgeProvider>
    </QueryClientProvider>,
  );
  return root;
}
