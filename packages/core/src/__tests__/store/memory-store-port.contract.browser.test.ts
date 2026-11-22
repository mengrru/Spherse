import { describe } from "vitest";
import { IdbMemoryStore } from "../../store/idb-memory-store.js";
import { OpfsFsPort } from "../../store/opfs-fs-port.js";
import { runMemoryStorePortContract } from "./port-contracts.js";

describe("IdbMemoryStore", () => {
  runMemoryStorePortContract("IdbMemoryStore", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fsPort = await OpfsFsPort.open(`memory-contract-${suffix}`);
    const store = await IdbMemoryStore.open(`memory-contract-${suffix}`, fsPort);
    return {
      store,
      close: async () => {
        store.close();
        await fsPort.destroy();
      },
    };
  });
});
