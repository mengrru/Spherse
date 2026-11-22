import type { RpcMethodEntry } from "../context.js";
import { sessionMethods } from "./sessions.js";
import { agentMethods } from "./agents.js";
import { contentMethods } from "./content.js";
import { settingsMethods } from "./settings.js";
import { connectionMethods } from "./connection.js";
import { triggerMethods } from "./triggers.js";
import { debugMethods } from "./debug.js";
import { skillMethods } from "./skills.js";
import { marketplaceMethods } from "./marketplace.js";
import { chatMethods } from "./chat.js";

export function buildMethodRegistry(): Map<string, RpcMethodEntry> {
  const entries: Array<Record<string, RpcMethodEntry>> = [
    sessionMethods,
    agentMethods,
    contentMethods,
    settingsMethods,
    connectionMethods,
    triggerMethods,
    debugMethods,
    skillMethods,
    marketplaceMethods,
    chatMethods,
  ];
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
