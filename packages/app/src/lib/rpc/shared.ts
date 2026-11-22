import { RpcClient, type RpcTransport } from "@spherse/rpc";
import { RpcWsTransport } from "./ws-transport";

interface SharedEntry {
  client: RpcClient;
}

const shared = new Map<string, SharedEntry>();

export type RpcAccessTokenGetter = () => string | null;

let localTransportFactory: (() => RpcTransport) | null = null;

export function setLocalRuntimeTransportFactory(factory: () => RpcTransport): void {
  localTransportFactory = factory;
}

export function isLocalRuntimeBaseUrl(baseUrl: string): boolean {
  return localTransportFactory !== null && baseUrl !== "" && baseUrl === window.location.origin;
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
