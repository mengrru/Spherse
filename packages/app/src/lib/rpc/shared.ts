import { RpcClient } from "@spherse/rpc";
import { RpcWsTransport } from "./ws-transport.js";

interface SharedEntry {
  client: RpcClient;
}

const shared = new Map<string, SharedEntry>();

function keyOf(baseUrl: string, accessToken: string | null): string {
  return `${baseUrl}\n${accessToken ?? ""}`;
}

export function getSharedRpcClient(baseUrl: string, accessToken: string | null): RpcClient {
  const key = keyOf(baseUrl, accessToken);
  const existing = shared.get(key);
  if (existing) return existing.client;
  const client = new RpcClient(
    new RpcWsTransport({
      baseUrl: () => baseUrl,
      accessToken: () => accessToken,
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
