const WELCOME_PAGE_EXTENSIONS = new Set(["html", "htm", "png", "jpg", "jpeg", "gif", "webp", "svg"]);
const SIDE_PANEL_EXTENSIONS = new Set(["html", "htm"]);

function normalizeProjectPagePath(input: string, extensions: ReadonlySet<string>): string | null {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed === "." || trimmed.startsWith("/") || trimmed.includes("..")) return null;
  const normalized = trimmed.replace(/^\.\//, "").replace(/\/+/g, "/");
  if (!normalized) return null;
  if (normalized === ".spherse" || normalized.startsWith(".spherse/")) return null;
  const ext = normalized.split(".").pop()?.toLowerCase();
  if (!ext || !extensions.has(ext)) return null;
  return normalized;
}

export function normalizeWelcomePagePath(input: string): string | null {
  return normalizeProjectPagePath(input, WELCOME_PAGE_EXTENSIONS);
}

export function normalizeSidePanelPath(input: string): string | null {
  return normalizeProjectPagePath(input, SIDE_PANEL_EXTENSIONS);
}
