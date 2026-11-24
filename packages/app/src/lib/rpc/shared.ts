import { RpcClient, type RpcTransport } from "@spherse/rpc";
import { RpcWsTransport } from "./ws-transport";

interface SharedEntry {
  client: RpcClient;
}

const shared = new Map<string, SharedEntry>();

export type RpcAccessTokenGetter = () => string | null;

let localTransportFactory: (() => RpcTransport) | null = null;

export function setLocalRuntimeTransportFactory(factory: (() => RpcTransport) | null): void {
  localTransportFactory = factory;
}

export function isLocalRuntimeBaseUrl(baseUrl: string): boolean {
  return localTransportFactory !== null && baseUrl !== "" && baseUrl === window.location.origin;
}

export function localAssetPrefix(baseUrl: string): string {
  return isLocalRuntimeBaseUrl(baseUrl) ? import.meta.env.BASE_URL : "";
}

function normalizedAssetBase(): string {
  const base = import.meta.env.BASE_URL;
  if (!base || base === "./" || base === "/") return "";
  return base.endsWith("/") ? base : `${base}/`;
}

export function resolveResourcePath(baseUrl: string, path: string): string {
  if (isLocalRuntimeBaseUrl(baseUrl)) {
    const base = normalizedAssetBase();
    if (base === "") return path;
    return path.startsWith("/") ? `${base}${path.slice(1)}` : `${base}${path}`;
  }
  return `${baseUrl}${path}`;
}

export function getSharedRpcClient(baseUrl: string, accessToken: RpcAccessTokenGetter): RpcClient {
  const key = baseUrl;
  const existing = shared.get(key);
  if (existing) return existing.client;
  const transport = isLocalRuntimeBaseUrl(baseUrl)
    ? localTransportFactory!()
    : new RpcWsTransport({
        baseUrl: () => baseUrl,
        accessToken: () => accessToken() ?? null,
      });
  const client = new RpcClient(transport);
  void client.connect().catch(() => {});
  const entry: SharedEntry = { client };
  shared.set(key, entry);
  return client;
}

export function disposeSharedRpcClients(): void {
  for (const entry of shared.values()) entry.client.dispose();
  shared.clear();
}
