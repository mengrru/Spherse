import type { FastifyInstance } from "fastify";
import { createMultiProjectServer } from "@spherse/server";
import type { ProjectRegistry } from "@spherse/server";
import { getSettings } from "./settings.js";

let serverHandle: { fastify: FastifyInstance; registry: ProjectRegistry } | null = null;

export async function ensureServer(): Promise<void> {
  if (serverHandle) return;
  const settings = getSettings();
  const result = await createMultiProjectServer({
    defaultModel: settings?.models?.text?.defaultModel,
    temperature: settings?.models?.text?.temperature,
  });
  serverHandle = { fastify: result.fastify, registry: result.registry };
}

export function getServerPort(): number {
  if (!serverHandle) throw new Error("Server not started");
  const address = serverHandle.fastify.server.address();
  return typeof address === "object" && address ? address.port : 0;
}

export async function registerProject(projectRoot: string): Promise<{ projectId: string }> {
  if (!serverHandle) throw new Error("Server not started");
  const ctx = await serverHandle.registry.register(projectRoot);
  return { projectId: ctx.projectId };
}

export async function unregisterProject(projectId: string): Promise<void> {
  if (!serverHandle) return;
  await serverHandle.registry.remove(projectId);
}

export function updateDefaultModel(defaultModel: string | undefined): void {
  if (!serverHandle) return;
  serverHandle.registry.setDefaultModel(defaultModel);
}

export function updateTemperature(temperature: number | undefined): void {
  if (!serverHandle) return;
  serverHandle.registry.setTemperature(temperature);
}

export async function stopServer(): Promise<void> {
  if (!serverHandle) return;
  await serverHandle.registry.removeAll();
  await serverHandle.fastify.close();
  serverHandle = null;
}
