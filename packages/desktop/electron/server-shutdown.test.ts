import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface CloseCall {
  stageTimeoutMs?: number;
  onStageOutcome?: (stage: string, outcome: string, detail: unknown) => void;
}

const { createServerMock, serverClose, registryListInfo } = vi.hoisted(() => ({
  createServerMock: vi.fn(),
  serverClose: vi.fn(async (_options?: CloseCall) => undefined),
  registryListInfo: vi.fn(() => []),
}));

vi.mock("electron", () => ({
  app: { getVersion: () => "0.0.0-test" },
}));
vi.mock("./settings.js", () => ({
  getSettings: () => undefined,
  getMobileAccess: () => ({}),
  getServerToken: () => "shutdown-test-token",
}));
vi.mock("./model-catalog.js", () => ({
  getAppCatalog: () => undefined,
  getAppModelCatalog: () => undefined,
}));
vi.mock("@spherse/server", () => ({
  createMultiProjectServer: createServerMock,
}));

import { ensureServer, stopServer, restartServer } from "./server.js";

function mockHandle(): void {
  serverClose.mockResolvedValue(undefined);
  registryListInfo.mockReturnValue([]);
  createServerMock.mockResolvedValue({
    fastify: { server: { address: () => ({ port: 1 }) } },
    registry: { register: async () => ({}), listInfo: registryListInfo, removeAll: async () => undefined },
    logger: { info: () => undefined, warn: () => undefined },
    addAllowedHosts: () => undefined,
    removeAllowedHosts: () => undefined,
    close: serverClose,
  });
}

describe("desktop server shutdown delegation", () => {
  beforeEach(async () => {
    mockHandle();
    await ensureServer();
  });

  afterEach(async () => {
    await stopServer();
    vi.clearAllMocks();
  });

  it("delegates stopServer to server.close with the staged timeout policy", async () => {
    await stopServer();

    expect(serverClose).toHaveBeenCalledTimes(1);
    const options = serverClose.mock.calls[0]![0]!;
    expect(options.stageTimeoutMs).toBe(10_000);
    expect(typeof options.onStageOutcome).toBe("function");
  });

  it("is a no-op when the server is already stopped", async () => {
    await stopServer();
    await stopServer();

    expect(serverClose).toHaveBeenCalledTimes(1);
  });

  it("routes restartServer through the same close", async () => {
    await restartServer();

    expect(serverClose).toHaveBeenCalledTimes(1);
    expect(registryListInfo).toHaveBeenCalled();
  });
});
