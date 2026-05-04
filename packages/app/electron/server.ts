import type { FastifyInstance } from "fastify";
import { createServer } from "@worldbuilding-agent/server";
import { getSettings } from "./settings.js";

let server: FastifyInstance | null = null;

export async function startServer(projectRoot: string): Promise<number> {
  const settings = getSettings();
  server = await createServer(projectRoot, {
    defaultModel: settings?.defaultModel,
  });
  const address = server.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return port;
}

export function getServer(): FastifyInstance | null {
  return server;
}

export function closeServer(): void {
  if (server) {
    server.close();
    server = null;
  }
}
