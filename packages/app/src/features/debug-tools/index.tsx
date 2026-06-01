import { useState, useEffect } from "react";
import { DebugMenu } from "./DebugMenu";

export function DebugTools() {
  const [isDev, setIsDev] = useState(false);

  useEffect(() => {
    window.electronAPI.isDev().then(setIsDev);
  }, []);

  if (!isDev) return null;

  return <DebugMenu />;
}
