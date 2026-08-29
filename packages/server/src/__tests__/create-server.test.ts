import { afterEach, describe, expect, it } from "vitest";
import net, { type AddressInfo, type Server } from "node:net";
import { createMultiProjectServer, DEFAULT_SERVER_PORT, type MultiProjectServer } from "../index.js";

function occupyPort(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

function closeNet(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("createMultiProjectServer port binding", () => {
  const servers: MultiProjectServer[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const s = servers.pop()!;
      await s.fastify.close();
    }
  });

  it("exports DEFAULT_SERVER_PORT constant", () => {
    expect(DEFAULT_SERVER_PORT).toBe(53972);
  });

  it("binds to the configured port when free", async () => {
    const port = await getFreePort();
    const server = await createMultiProjectServer({ port });
    servers.push(server);
    const address = server.fastify.server.address() as AddressInfo;
    expect(address.port).toBe(port);
  });

  it("enables forceCloseConnections so close cannot hang on leftover sockets", async () => {
    const port = await getFreePort();
    const server = await createMultiProjectServer({ port });
    servers.push(server);
    expect(server.fastify.initialConfig.forceCloseConnections).toBe(true);
  });

  it("falls back to an OS-assigned port when the preferred port is in use", async () => {
    const port = await getFreePort();
    const blocker = await occupyPort(port);
    try {
      const server = await createMultiProjectServer({ port });
      servers.push(server);
      const address = server.fastify.server.address() as AddressInfo;
      expect(address.port).not.toBe(port);
      expect(address.port).toBeGreaterThan(0);
    } finally {
      await closeNet(blocker);
    }
  });
});
