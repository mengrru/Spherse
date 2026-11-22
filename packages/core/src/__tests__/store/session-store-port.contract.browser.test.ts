import { describe } from "vitest";
import { IdbSessionStore } from "../../store/idb-session-store.js";
import { runSessionStorePortContract } from "./port-contracts.js";

describe("IdbSessionStore", () => {
  runSessionStorePortContract("IdbSessionStore", async () => {
    const storeKey = `session-contract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const store = await IdbSessionStore.open(storeKey, "agent-main");
    return {
      store,
      close: () => store.close(),
    };
  });
});
