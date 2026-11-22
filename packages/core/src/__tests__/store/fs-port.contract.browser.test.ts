import { describe, expect, it } from "vitest";
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

  it("opens nested root dir names and destroys only the leaf", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sibling = await OpfsFsPort.open(`fs-port-nested-${stamp}/sibling`);
    const leaf = await OpfsFsPort.open(`fs-port-nested-${stamp}/parent/leaf`);
    await leaf.writeFile("file.txt", "leaf");
    await sibling.writeFile("file.txt", "sibling");
    expect(await leaf.readFile("file.txt")).toBe("leaf");

    await leaf.destroy();
    expect(await leaf.stat("file.txt")).toBeNull();

    const root = await navigator.storage.getDirectory();
    const base = await root.getDirectoryHandle(`fs-port-nested-${stamp}`);
    const parent = await base.getDirectoryHandle("parent");
    await expect(parent.removeEntry("leaf")).rejects.toThrow();
    expect(await sibling.readFile("file.txt")).toBe("sibling");
    await sibling.destroy();
    await root.removeEntry(`fs-port-nested-${stamp}`, { recursive: true });
  });
});
