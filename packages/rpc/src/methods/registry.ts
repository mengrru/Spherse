import type { RpcMethodEntry } from "../context.js";
import { sessionMethods } from "./sessions.js";
import { agentMethods } from "./agents.js";
import { triggerMethods } from "./triggers.js";
import { debugMethods } from "./debug.js";
import { chatMethods } from "./chat.js";
import { connectionMethods } from "./connection.js";

export function buildBaseMethodRegistry(): Map<string, RpcMethodEntry> {
  const entries: Array<Record<string, RpcMethodEntry>> = [
    sessionMethods,
    agentMethods,
    triggerMethods,
    debugMethods,
    chatMethods,
    connectionMethods,
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
