import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SqliteSessionStore } from "../../store/session.js";
import { runSessionStorePortContract } from "./port-contracts.js";

runSessionStorePortContract("SqliteSessionStore", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "port-contract-session-"));
  const store = new SqliteSessionStore(path.join(tmpDir, "sessions.db"), "contract-agent");
  return { store, close: () => { store.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); } };
});
