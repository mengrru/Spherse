const LAST_ROUTE_STORAGE_PREFIX = "spherse:last-route:";

export function getLastRoute(projectId: string): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(LAST_ROUTE_STORAGE_PREFIX + projectId);
}

export function setLastRoute(projectId: string, route: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LAST_ROUTE_STORAGE_PREFIX + projectId, route);
}

export function clearLastRoute(projectId: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(LAST_ROUTE_STORAGE_PREFIX + projectId);
}
