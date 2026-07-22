export type JsonCheckResult = { ok: true } | { ok: false; error: string };

export function checkJson(content: string): JsonCheckResult {
  if (content.trim() === "") {
    return { ok: true };
  }
  try {
    JSON.parse(content);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
