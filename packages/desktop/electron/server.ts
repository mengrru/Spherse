import type { FastifyInstance } from "fastify";
import { app } from "electron";
import { createMultiProjectServer } from "@spherse/server";
import type { ProjectRegistry, MultiProjectServer } from "@spherse/server";
import type { SamplingParams, ThinkingLevel } from "@spherse/core";
import { settleWithin } from "@spherse/core";
import { getSettings, getMobileAccess, getServerToken } from "./settings.js";
import { getAppModelCatalog } from "./model-catalog.js";
import { getTunnelManager } from "./tunnel/manager.js";

interface ServerHandle {
  server: MultiProjectServer;
  fastify: FastifyInstance;
  registry: ProjectRegistry;
}

const SERVER_STAGE_TIMEOUT_MS = 10_000;

function logStageOutcome(stage: string, outcome: "timeout" | "error", detail?: unknown): void {
  if (outcome === "error") {
    console.error(`[server] shutdown stage "${stage}" failed:`, detail);
  } else {
    console.error(`[server] shutdown stage "${stage}" timed out after ${SERVER_STAGE_TIMEOUT_MS}ms, continuing`);
  }
}

async function closeServerHandle(handle: ServerHandle): Promise<void> {
  await settleWithin(handle.registry.removeAll(), SERVER_STAGE_TIMEOUT_MS, (outcome, detail) => {
    logStageOutcome("registry.removeAll", outcome, detail);
  });
  await settleWithin(handle.fastify.close(), SERVER_STAGE_TIMEOUT_MS, (outcome, detail) => {
    logStageOutcome("fastify.close", outcome, detail);
  });
}

let serverHandle: ServerHandle | null = null;
let registeredProjects: Array<{ root: string; lastOpened?: string }> = [];
let appliedHosts: string[] = [];

function desiredHosts(): string[] {
  const mobile = getMobileAccess();
  if (!mobile.enabled) return [];
  if (mobile.mode === "manual") {
    return mobile.publicDomain?.trim() ? [mobile.publicDomain.trim()] : [];
  }
  const publicUrl = getTunnelManager().getState().publicUrl;
  return publicUrl ? [publicUrl] : [];
}

export function syncAllowedHosts(): void {
  if (!serverHandle) return;
  const desired = desiredHosts();
  if (appliedHosts.length) serverHandle.server.removeAllowedHosts(appliedHosts);
  if (desired.length) serverHandle.server.addAllowedHosts(desired);
  appliedHosts = desired;
}

export async function ensureServer(): Promise<void> {
  if (serverHandle) return;
  const settings = getSettings();
  const result = await createMultiProjectServer({
    defaultModel: settings?.models?.text?.defaultModel,
    sampling: settings?.models?.text?.sampling,
    thinkingLevel: settings?.models?.text?.thinkingLevel,
    auth: { accessToken: getServerToken() },
    modelCatalog: getAppModelCatalog(),
    appVersion: app.getVersion(),
  });
  serverHandle = { server: result, fastify: result.fastify, registry: result.registry };
  appliedHosts = [];
  for (const { root, lastOpened } of registeredProjects) {
    try {
      await serverHandle.registry.register(root, lastOpened ? { lastOpened } : undefined);
    } catch (err) {
      console.error(`[ensureServer] failed to re-register project at ${root}:`, err);
    }
  }
  syncAllowedHosts();
}

export async function restartServer(): Promise<void> {
  if (serverHandle) {
    const handle = serverHandle;
    serverHandle = null;
    registeredProjects = handle.registry.listInfo().map((info) => ({
      root: info.rootPath,
      lastOpened: info.lastOpened,
    }));
    await closeServerHandle(handle);
  }
}

export function getServerPort(): number {
  if (!serverHandle) throw new Error("Server not started");
  const address = serverHandle.fastify.server.address();
  return typeof address === "object" && address ? address.port : 0;
}

export async function registerProject(
  projectRoot: string,
  options?: { lastOpened?: string },
): Promise<{ projectId: string }> {
  if (!serverHandle) throw new Error("Server not started");
  const ctx = await serverHandle.registry.register(projectRoot, options);
  if (!registeredProjects.some((p) => p.root === projectRoot)) {
    registeredProjects.push({ root: projectRoot, lastOpened: options?.lastOpened });
  }
  return { projectId: ctx.projectId };
}

export function setProjectLastOpened(projectId: string, lastOpened: string): void {
  if (!serverHandle) return;
  serverHandle.registry.setLastOpened(projectId, lastOpened);
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

export function updateThinkingLevel(thinkingLevel: ThinkingLevel | undefined): void {
  if (!serverHandle) return;
  serverHandle.registry.setThinkingLevel(thinkingLevel);
}

export async function stopServer(): Promise<void> {
  if (!serverHandle) return;
  const handle = serverHandle;
  serverHandle = null;
  await closeServerHandle(handle);
  registeredProjects = [];
  appliedHosts = [];
}
