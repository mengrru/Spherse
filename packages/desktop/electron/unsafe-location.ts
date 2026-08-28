import path from "node:path";
import { app } from "electron";
import { isPathInside } from "@spherse/core";

export function getUnsafeZoneRoot(): string | null {
  if (!app.isPackaged) {
    const override = process.env.SPHERSE_UNSAFE_ZONE;
    if (override) return path.resolve(override);
    return null;
  }
  if (process.platform === "win32") {
    return path.win32.dirname(process.execPath);
  }
  if (process.platform === "darwin") {
    let current = process.execPath;
    for (;;) {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
      if (current.toLowerCase().endsWith(".app")) return current;
    }
  }
  return null;
}

export function isInsideUnsafeZone(targetPath: string): boolean {
  const zone = getUnsafeZoneRoot();
  if (!zone) return false;
  return isPathInside(zone, targetPath);
}
