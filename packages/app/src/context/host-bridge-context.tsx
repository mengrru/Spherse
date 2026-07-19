import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { HostBridge } from "../lib/host-bridge";

const HostBridgeContext = createContext<HostBridge | null>(null);

interface HostBridgeProviderProps {
  bridge: HostBridge;
  children: ReactNode;
}

export function HostBridgeProvider({ bridge, children }: HostBridgeProviderProps) {
  const value = useMemo<HostBridge>(() => bridge, [bridge]);
  return <HostBridgeContext.Provider value={value}>{children}</HostBridgeContext.Provider>;
}

export function useHostBridge(): HostBridge {
  const bridge = useContext(HostBridgeContext);
  if (!bridge) {
    throw new Error("useHostBridge must be used within HostBridgeProvider");
  }
  return bridge;
}

export function useHostBridgeOrNull(): HostBridge | null {
  return useContext(HostBridgeContext);
}
