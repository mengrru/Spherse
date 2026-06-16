import path from "node:path";
import { AccessDeniedError } from "../errors.js";
import { PROJECT_META_DIR } from "../types.js";

export function isPathInside(projectRoot: string, targetPath: string): boolean {
  const root = path.resolve(projectRoot);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertInsideProject(
  projectRoot: string,
  targetPath: string,
  inputPath: string,
): string {
  const resolved = path.resolve(targetPath);
  if (!isPathInside(projectRoot, resolved)) {
    throw new AccessDeniedError(`Path traversal denied: ${inputPath}`);
  }
  return resolved;
}

export function resolveProjectPath(
  projectRoot: string,
  relativePath: string,
): string {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, relativePath);
  return assertInsideProject(root, resolved, relativePath);
}

export function isProjectMetaPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return normalized === PROJECT_META_DIR || normalized.startsWith(`${PROJECT_META_DIR}/`);
}
