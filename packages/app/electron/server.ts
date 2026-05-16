import type { FastifyInstance } from "fastify";
import { createServer } from "@spherse/server";
import { getSettings } from "./settings.js";

const servers = new Map<string, { server: FastifyInstance; port: number }>();

export async function startServer(projectRoot: string): Promise<number> {
  const existing = servers.get(projectRoot);
  if (existing) return existing.port;

  const settings = getSettings();
  const server = await createServer(projectRoot, {
    defaultModel: settings?.defaultModel,
  });
  const address = server.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  servers.set(projectRoot, { server, port });
  return port;
}

export function stopServer(projectRoot: string): void {
  const entry = servers.get(projectRoot);
  if (entry) {
    entry.server.close();
    servers.delete(projectRoot);
  }
}

export function getServerPort(projectRoot: string): number | undefined {
  return servers.get(projectRoot)?.port;
}

export async function stopAllServers(): Promise<void> {
  const entries = [...servers.entries()];
  servers.clear();
  await Promise.all(entries.map(([, entry]) => entry.server.close()));
}
