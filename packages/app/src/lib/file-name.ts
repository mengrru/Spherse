export function fileBasename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function fileDisplayName(path: string): string {
  const name = fileBasename(path);
  const match = name.match(/^(.+)\.[^.]+$/);
  return match ? match[1] : name;
}
