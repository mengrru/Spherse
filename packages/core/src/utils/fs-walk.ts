export function shouldSkipDirEntry(name: string): boolean {
  return name.startsWith(".") || name === "node_modules" || name === ".git";
}
