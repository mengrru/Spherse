import { HostServiceKey } from "@spherse/core";
import type { HostContext } from "@spherse/core";
import type { RpcMethodEntry } from "./context.js";

export function registerRpcMethodGroups(
  host: HostContext,
  groups: Array<Record<string, RpcMethodEntry> | Map<string, RpcMethodEntry>>,
): Map<string, RpcMethodEntry> {
  const existing = host.get(HostServiceKey.rpcMethods);
  let methods: Map<string, RpcMethodEntry>;
  if (existing instanceof Map) {
    methods = existing;
  } else {
    methods = new Map<string, RpcMethodEntry>();
    host.provide(HostServiceKey.rpcMethods, methods);
  }
  for (const group of groups) {
    const entries = group instanceof Map ? group : Object.entries(group);
    for (const [name, entry] of entries) {
      if (methods.has(name)) {
        throw new Error(`Duplicate rpc method: ${name}`);
      }
      methods.set(name, entry);
    }
  }
  return methods;
}

export function getRpcMethodGroups(host: HostContext): Map<string, RpcMethodEntry> {
  const methods = host.get(HostServiceKey.rpcMethods);
  if (!(methods instanceof Map)) {
    throw new Error("rpc method groups are not registered on this host");
  }
  return methods;
}
