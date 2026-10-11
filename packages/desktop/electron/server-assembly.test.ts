import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let userDataDir = "";

vi.mock("electron", () => ({
  app: { getVersion: () => "0.0.0-test" },
}));

vi.mock("./settings.js", () => ({
  getServerToken: () => "assembly-test-token",
  getMobileAccess: () => ({ enabled: false, mode: "quick" }),
  getModelSettingsPath: () => path.join(userDataDir, "model-settings.json"),
}));

vi.mock("./tunnel/manager.js", () => ({
  getTunnelManager: () => ({ getState: () => ({ status: "stopped", publicUrl: null, startedAt: null, error: null }) }),
}));

import { ensureServer, stopServer, getServerPort } from "./server.js";

describe("desktop server assembly with real @spherse/server", () => {
  beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-server-assembly-"));
    fs.writeFileSync(
      path.join(userDataDir, "model-settings.json"),
      JSON.stringify({
        text: {
          defaultModel: "custom-assembly/m1",
          providers: { "custom-assembly": { apiKey: "sk-assembly" } },
          sampling: { temperature: 0.3 },
        },
        image: { defaultModel: "", providers: {} },
        customProviders: [
          {
            id: "custom-assembly",
            name: "Assembly",
            baseUrl: "https://assembly.example/v1",
            models: ["m1"],
            keyless: false,
          },
        ],
      }),
    );
    await ensureServer();
  });

  afterAll(async () => {
    await stopServer();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  async function api(pathname: string): Promise<unknown> {
    const port = getServerPort();
    const res = await fetch(`http://localhost:${port}${pathname}`, {
      headers: { Authorization: "Bearer assembly-test-token" },
    });
    expect(res.ok).toBeTruthy();
    return res.json();
  }

  it("server startup loads model settings from the seeded file", async () => {
    const settings = (await api("/api/settings/models")) as {
      models: { text: { defaultModel: string; providers: Record<string, { configured: boolean }> } };
    };
    expect(settings.models.text.defaultModel).toBe("custom-assembly/m1");
    expect(settings.models.text.providers["custom-assembly"]).toEqual({ configured: true });
  });

  it("custom providers are registered on the server-owned catalog", async () => {
    const providers = (await api("/api/settings/providers")) as Record<
      string,
      { name: string; custom?: boolean }
    >;
    expect(providers["custom-assembly"]).toMatchObject({ name: "Assembly", custom: true });
  });
});
