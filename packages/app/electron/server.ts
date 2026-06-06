import type { FastifyInstance } from "fastify";
import { createServer } from "@spherse/server";
import type { Engine } from "@spherse/core";
import { getSettings, getLocale } from "./settings.js";

const servers = new Map<string, { server: FastifyInstance; port: number; engine: Engine }>();

export async function startServer(projectRoot: string): Promise<number> {
  const existing = servers.get(projectRoot);
  if (existing) return existing.port;

  const settings = getSettings();
  const { engine, fastify } = await createServer(projectRoot, {
    defaultModel: settings?.defaultModel,
  });

  const address = fastify.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  servers.set(projectRoot, { server: fastify, port, engine });
  return port;
}

export function updateDefaultModel(defaultModel: string | undefined): void {
  for (const [, entry] of servers) {
    entry.engine.setDefaultModel(defaultModel);
  }
}

export function getServerLocale(): string {
  return getLocale();
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
