import { RpcClient } from "@spherse/rpc";
import { RpcWsTransport } from "./ws-transport";

interface SharedEntry {
  client: RpcClient;
}

const shared = new Map<string, SharedEntry>();

export type RpcAccessTokenGetter = () => string | null;

export function getSharedRpcClient(baseUrl: string, accessToken: RpcAccessTokenGetter): RpcClient {
  const key = baseUrl;
  const existing = shared.get(key);
  if (existing) return existing.client;
  const client = new RpcClient(
    new RpcWsTransport({
      baseUrl: () => baseUrl,
      accessToken: () => accessToken() ?? null,
    }),
  );
  void client.connect().catch(() => {});
  const entry: SharedEntry = { client };
  shared.set(key, entry);
  return client;
}

export function disposeSharedRpcClients(): void {
  for (const entry of shared.values()) entry.client.dispose();
  shared.clear();
}
