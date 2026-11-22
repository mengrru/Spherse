import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SqliteMemoryStore } from "../../store/memory.js";
import { runMemoryStorePortContract } from "./port-contracts.js";

runMemoryStorePortContract("SqliteMemoryStore", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "port-contract-memory-"));
  const store = new SqliteMemoryStore(tmpDir);
  return { store, close: () => { store.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); } };
});
