import path from "node:path";
import { isPathInside } from "@spherse/core";

export function isInsideAnyOpenProject(absoluteFilePath: string, projectRoots: string[]): boolean {
  const absolute = path.resolve(absoluteFilePath);
  return projectRoots.some((root) => isPathInside(root, absolute));
}
