import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createServerMock, fastifyClose, registryRemoveAll, registryListInfo } = vi.hoisted(() => ({
  createServerMock: vi.fn(),
  fastifyClose: vi.fn(),
  registryRemoveAll: vi.fn(),
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
  getAppModelCatalog: () => undefined,
}));
vi.mock("@spherse/server", () => ({
  createMultiProjectServer: createServerMock,
}));

import { ensureServer, stopServer, restartServer } from "./server.js";

function mockHandle(): void {
  fastifyClose.mockResolvedValue(undefined);
  registryRemoveAll.mockResolvedValue(undefined);
  registryListInfo.mockReturnValue([]);
  createServerMock.mockResolvedValue({
    fastify: { close: fastifyClose },
    registry: { removeAll: registryRemoveAll, listInfo: registryListInfo },
  });
}

describe("stopServer staged shutdown", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    mockHandle();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await ensureServer();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await stopServer();
    consoleError.mockRestore();
    vi.clearAllMocks();
  });

  it("times out a hanging registry.removeAll and still closes fastify", async () => {
    registryRemoveAll.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    let resolved = false;
    void stopServer().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
    expect(fastifyClose).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('"registry.removeAll"'),
    );
  });

  it("times out a hanging fastify.close and still resolves", async () => {
    fastifyClose.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    let resolved = false;
    void stopServer().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('"fastify.close"'),
    );
  });

  it("logs and continues when a stage rejects", async () => {
    registryRemoveAll.mockRejectedValue(new Error("boom"));
    await stopServer();
    expect(fastifyClose).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      '[server] shutdown stage "registry.removeAll" failed:',
      expect.objectContaining({ message: "boom" }),
    );
  });

  it("is a no-op when the server is already stopped", async () => {
    await stopServer();
    expect(registryRemoveAll).toHaveBeenCalledTimes(1);
    await stopServer();
    expect(registryRemoveAll).toHaveBeenCalledTimes(1);
  });

  it("routes restartServer through the same staged close", async () => {
    await restartServer();
    expect(registryRemoveAll).toHaveBeenCalledTimes(1);
    expect(fastifyClose).toHaveBeenCalledTimes(1);
  });
});
