import type { FastifyInstance } from "fastify";
import { createMultiProjectServer } from "@spherse/server";
import type { ProjectRegistry } from "@spherse/server";
import type { SamplingParams } from "@spherse/core";
import { getSettings, getMobileAccess } from "./settings.js";

interface ServerHandle {
  fastify: FastifyInstance;
  registry: ProjectRegistry;
}

let serverHandle: ServerHandle | null = null;
let activeAccessToken: string | undefined;
let registeredProjectRoots: string[] = [];

export async function ensureServer(): Promise<void> {
  if (serverHandle) return;
  const settings = getSettings();
  const mobile = getMobileAccess();
  activeAccessToken = mobile.enabled ? mobile.token : undefined;
  const result = await createMultiProjectServer({
    defaultModel: settings?.models?.text?.defaultModel,
    sampling: settings?.models?.text?.sampling,
    auth: activeAccessToken ? { accessToken: activeAccessToken } : undefined,
  });
  serverHandle = { fastify: result.fastify, registry: result.registry };
  for (const root of registeredProjectRoots) {
    try {
      await serverHandle.registry.register(root);
    } catch {
      // ignore projects that no longer exist
    }
  }
}

export async function restartServerWithAuth(token: string | undefined): Promise<void> {
  if (serverHandle) {
    registeredProjectRoots = [...serverHandle.registry.listInfo().map((info) => info.rootPath)];
    await serverHandle.registry.removeAll();
    await serverHandle.fastify.close();
    serverHandle = null;
  }
  activeAccessToken = token;
}

export function getServerPort(): number {
  if (!serverHandle) throw new Error("Server not started");
  const address = serverHandle.fastify.server.address();
  return typeof address === "object" && address ? address.port : 0;
}

export async function registerProject(projectRoot: string): Promise<{ projectId: string }> {
  if (!serverHandle) throw new Error("Server not started");
  const ctx = await serverHandle.registry.register(projectRoot);
  if (!registeredProjectRoots.includes(projectRoot)) {
    registeredProjectRoots.push(projectRoot);
  }
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

export function updateSampling(sampling: SamplingParams | undefined): void {
  if (!serverHandle) return;
  serverHandle.registry.setSampling(sampling);
}

export async function stopServer(): Promise<void> {
  if (!serverHandle) return;
  await serverHandle.registry.removeAll();
  await serverHandle.fastify.close();
  serverHandle = null;
  registeredProjectRoots = [];
  activeAccessToken = undefined;
}
