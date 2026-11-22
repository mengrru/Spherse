import { describe } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { NodeFsPort } from "../../store/node-fs-port.js";
import { runFsPortContract } from "./fs-port-contracts.js";

describe("NodeFsPort", () => {
  runFsPortContract("NodeFsPort", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-port-contract-"));
    return {
      port: new NodeFsPort(tmpDir),
      close: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
    };
  });
});
