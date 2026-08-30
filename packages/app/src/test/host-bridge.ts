import { vi } from "vitest";
import type { HostBridge, HostCapabilities } from "../lib/host-bridge";

export type HostBridgeOverrides = Partial<Omit<HostBridge, "capabilities">> & {
  capabilities?: Partial<HostCapabilities>;
};

export function createMockHostBridge(overrides: HostBridgeOverrides = {}): HostBridge {
  const { capabilities, ...rest } = overrides;
  const base: HostBridge = {
    kind: "electron",
    capabilities: {
      filePicker: true,
      mobileAccess: false,
      openFileExternal: true,
      content: { editable: true },
      ...capabilities,
    },
    getServerBaseUrl: vi.fn(async () => "http://localhost:5173"),
    getSettings: vi.fn(async () => null),
    saveSettings: vi.fn(async () => ({ success: true })),
    openExternal: vi.fn(async () => {}),
  };
  return { ...base, ...rest };
}
