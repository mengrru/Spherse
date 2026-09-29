import { WEB_APP_URL } from "./urls";

export interface ConnectPayload {
  baseUrl: string;
  token: string;
  targetPath?: string;
}

export function buildConnectUrl(opts: { baseUrl: string; token: string; targetPath?: string }): string {
  const params = new URLSearchParams({ base: opts.baseUrl, token: opts.token });
  if (opts.targetPath) {
    params.set("targetPath", opts.targetPath);
  }
  return `${WEB_APP_URL}#/?${params.toString()}`;
}

export function parseConnectPayload(text: string): ConnectPayload | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const candidates: URLSearchParams[] = [url.searchParams];
  const hash = url.hash.replace(/^#/, "");
  const hashQueryStart = hash.indexOf("?");
  if (hashQueryStart >= 0) {
    candidates.push(new URLSearchParams(hash.slice(hashQueryStart)));
  }
  for (const params of candidates) {
    const baseUrl = params.get("base");
    const token = params.get("token");
    if (!baseUrl || !token) continue;
    const targetPath = params.get("targetPath");
    return {
      baseUrl: baseUrl.replace(/\/+$/, ""),
      token,
      ...(targetPath ? { targetPath } : {}),
    };
  }
  return null;
}
