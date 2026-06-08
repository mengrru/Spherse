import path from "node:path";

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
    throw new Error(`Path traversal denied: ${inputPath}`);
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
