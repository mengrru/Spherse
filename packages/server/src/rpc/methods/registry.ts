import type { RpcMethodEntry } from "../context.js";
import { sessionMethods } from "./sessions.js";

export function buildMethodRegistry(): Map<string, RpcMethodEntry> {
  const entries: Array<Record<string, RpcMethodEntry>> = [sessionMethods];
  const methods = new Map<string, RpcMethodEntry>();
  for (const group of entries) {
    for (const [name, entry] of Object.entries(group)) {
      if (methods.has(name)) {
        throw new Error(`Duplicate rpc method: ${name}`);
      }
      methods.set(name, entry);
    }
  }
  return methods;
}
