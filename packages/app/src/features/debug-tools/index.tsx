import { useEffect, useState } from "react";
import { DebugMenu } from "./DebugMenu";
import { useSettingsStore } from "../../stores/settings-store";

export function DebugTools() {
  const [isDev, setIsDev] = useState(false);
  const debugToolsEnabled = useSettingsStore((s) => s.debugToolsEnabled);

  useEffect(() => {
    window.electronAPI.isDev().then(setIsDev);
  }, []);

  if (!isDev && !debugToolsEnabled) return null;

  return <DebugMenu />;
}
