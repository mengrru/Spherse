import { describe, expect, it, vi } from "vitest";
import { marketplaceService } from "../marketplace.js";
import { createHarness, waitForFrames } from "./rpc-marketplace-testing.js";

vi.mock("../marketplace.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../marketplace.js")>();
  return {
    ...actual,
    marketplaceService: { getManifest: vi.fn(), downloadZip: vi.fn() },
    projectMarketplaceService: { getManifest: vi.fn(), downloadZip: vi.fn() },
  };
});

describe("skills and marketplace param validation", () => {
  it("rejects skills.create with missing required fields", async () => {
    const harness = createHarness();
    harness.receive({
      type: "call",
      id: 20,
      method: "skills.create",
      params: { projectId: "p1", name: "demo-skill" },
    });
    const frames = await waitForFrames(harness);
    expect(frames[0]).toMatchObject({
      type: "result",
      id: 20,
      ok: false,
      error: { code: -32602, message: "Invalid params for skills.create" },
    });
    expect(harness.known.projectManager.createSkill).not.toHaveBeenCalled();
  });

  it("rejects skills.installMarketplace with unknown extra params", async () => {
    const harness = createHarness();
    harness.receive({
      type: "call",
      id: 21,
      method: "skills.installMarketplace",
      params: { projectId: "p1", name: "demo-skill", version: "1.0.0", extra: true },
    });
    const frames = await waitForFrames(harness);
    expect(frames[0]).toMatchObject({
      type: "result",
      id: 21,
      ok: false,
      error: { code: -32602 },
    });
    expect(marketplaceService.getManifest).not.toHaveBeenCalled();
  });

  it("maps an unknown project to app error 100", async () => {
    const harness = createHarness();
    harness.receive({
      type: "call",
      id: 22,
      method: "skills.list",
      params: { projectId: "missing" },
    });
    const frames = await waitForFrames(harness);
    expect(frames[0]).toMatchObject({
      type: "result",
      id: 22,
      ok: false,
      error: { code: 100, message: "Unknown project" },
    });
  });
});
