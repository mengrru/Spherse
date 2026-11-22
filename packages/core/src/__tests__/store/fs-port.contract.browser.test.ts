import { describe } from "vitest";
import { OpfsFsPort } from "../../store/opfs-fs-port.js";
import { runFsPortContract } from "./fs-port-contracts.js";

describe("OpfsFsPort", () => {
  runFsPortContract("OpfsFsPort", async () => {
    const rootName = `fs-port-contract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const port = await OpfsFsPort.open(rootName);
    return {
      port,
      close: () => port.destroy(),
    };
  });
});
