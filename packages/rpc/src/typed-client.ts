import { Value } from "@sinclair/typebox/value";
import { parseContract, rpcMethodSchemas, type RpcMethodSchema } from "@spherse/contracts";
import type { RpcClient } from "./index.js";

export type RpcMethodMap = {
  [K in keyof typeof rpcMethodSchemas]: {
    params: import("@sinclair/typebox").Static<(typeof rpcMethodSchemas)[K]["params"]>;
    result: import("@sinclair/typebox").Static<(typeof rpcMethodSchemas)[K]["result"]>;
  };
};

export class TypedRpcClient {
  constructor(private readonly client: RpcClient) {}

  call<M extends keyof RpcMethodMap>(
    method: M,
    ...args: keyof RpcMethodMap[M]["params"] extends never ? [] : [params: RpcMethodMap[M]["params"]]
  ): Promise<RpcMethodMap[M]["result"]> {
    const params = args.length > 0 ? (args[0] as Record<string, unknown>) : {};
    const schema = (rpcMethodSchemas as Record<string, RpcMethodSchema>)[method as string] as RpcMethodSchema | undefined;
    return this.client
      .call<unknown>(method as string, params)
      .then((data) => (schema ? parseContract(schema.result, data) : data)) as Promise<RpcMethodMap[M]["result"]>;
  }
}

export function createTypedRpcClient(client: RpcClient): TypedRpcClient {
  return new TypedRpcClient(client);
}

export function assertRpcMethodParams(method: string, params: unknown): void {
  const schema = (rpcMethodSchemas as Record<string, RpcMethodSchema>)[method];
  if (!schema) throw new Error(`Unknown rpc method: ${method}`);
  if (!Value.Check(schema.params, params)) throw new Error(`Invalid params for ${method}`);
}
