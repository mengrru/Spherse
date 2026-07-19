import { useEffect, useState } from "react";
import { DebugMenu } from "./DebugMenu";
import { useSettingsStore } from "../../stores/settings-store";
import { useHostBridge } from "../../context/host-bridge-context";

export function DebugTools() {
  const bridge = useHostBridge();
  const [isDev, setIsDev] = useState(false);
  const debugToolsEnabled = useSettingsStore((s) => s.debugToolsEnabled);

  useEffect(() => {
    void bridge.devTools?.isDev()?.then(setIsDev);
  }, []);

  if (!isDev && !debugToolsEnabled) return null;

  return <DebugMenu />;
}
