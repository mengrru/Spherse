import type { RpcMethodEntry } from "@spherse/rpc";
import { buildBaseMethodRegistry } from "@spherse/rpc";
import { contentMethods } from "./content.js";
import { settingsMethods } from "./settings.js";
import { skillMethods } from "./skills.js";
import { marketplaceMethods } from "./marketplace.js";

export function buildMethodRegistry(): Map<string, RpcMethodEntry> {
  const methods = buildBaseMethodRegistry();
  const entries: Array<Record<string, RpcMethodEntry>> = [
    contentMethods,
    settingsMethods,
    skillMethods,
    marketplaceMethods,
  ];
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
