import { buildBaseMethodRegistry } from "@spherse/rpc/methods";
import type { RpcMethodEntry } from "@spherse/rpc/host";
import { skillMethods } from "./skills.js";
import { attachmentMethods } from "./attachments.js";

export function buildBrowserMethodRegistry(
  registryMethods?: Record<string, RpcMethodEntry>,
): Map<string, RpcMethodEntry> {
  const methods = buildBaseMethodRegistry();
  const groups: Array<Record<string, RpcMethodEntry>> = [
    skillMethods,
    attachmentMethods,
    ...(registryMethods ? [registryMethods] : []),
  ];
  for (const group of groups) {
    for (const [name, entry] of Object.entries(group)) {
      if (methods.has(name)) {
        throw new Error(`Duplicate rpc method: ${name}`);
      }
      methods.set(name, entry);
    }
  }
  return methods;
}
