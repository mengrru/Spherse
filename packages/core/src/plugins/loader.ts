import path from "node:path";
import { pathToFileURL } from "node:url";
import { Value } from "@sinclair/typebox/value";
import type { FsPort } from "../store/fs-port.js";
import type { Logger } from "../logger.js";
import { isPathInside } from "../utils/path-safety.js";
import type { Capability } from "../kernel/capability.js";
import { pluginManifestSchema, type PluginManifest } from "./manifest.js";

export const PLUGINS_REL_DIR = ".spherse/plugins";

export interface SkippedPlugin {
  dir: string;
  stage: string;
  err: unknown;
}

export interface ExternalPluginLoadResult {
  capabilities: Capability[];
  skipped: SkippedPlugin[];
}

export interface PluginLoadReport {
  readonly loaded: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<SkippedPlugin>;
}

const FUNCTION_MEMBERS = [
  "init",
  "tools",
  "featureTools",
  "contextBlocks",
  "turnHooks",
  "onAgentDeleted",
  "onAgentConfigChanged",
  "shutdown",
] as const;

const ARRAY_MEMBERS = [
  "streamDecorators",
  "contextProjectors",
  "previewTransforms",
  "attachmentProcessors",
  "pathRules",
] as const;

function checkCapabilityShape(input: unknown): Capability | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return undefined;
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0) return undefined;
  for (const member of FUNCTION_MEMBERS) {
    const value = candidate[member];
    if (value !== undefined && typeof value !== "function") return undefined;
  }
  for (const member of ARRAY_MEMBERS) {
    const value = candidate[member];
    if (value !== undefined && !Array.isArray(value)) return undefined;
  }
  return candidate as unknown as Capability;
}

function wrapInit(capability: Capability, manifest: PluginManifest): Capability {
  if (capability.init === undefined) return capability;
  const original = capability.init;
  const wrapped: Capability = { ...capability };
  wrapped.init = async (ctx) => {
    try {
      await original(ctx);
    } catch (err) {
      throw new Error(`plugin "${manifest.name}" (capability "${capability.id}") init failed`, { cause: err });
    }
  };
  return wrapped;
}

export async function loadExternalCapabilities(
  projectRoot: string,
  fs: FsPort,
  logger: Logger,
  relDir: string = PLUGINS_REL_DIR,
): Promise<ExternalPluginLoadResult> {
  const capabilities: Capability[] = [];
  const skipped: SkippedPlugin[] = [];
  const seenIds = new Set<string>();
  const seenDirs = new Set<string>();

  let entries;
  try {
    entries = await fs.readdir(relDir);
  } catch {
    return { capabilities, skipped };
  }

  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    if (seenDirs.has(entry.name)) continue;
    seenDirs.add(entry.name);
    const pluginDirRel = `${relDir}/${entry.name}`;
    const pluginDirAbs = path.join(projectRoot, ...relDir.split("/"), entry.name);

    let manifest: PluginManifest;
    try {
      const raw = await fs.readFile(`${pluginDirRel}/manifest.json`);
      manifest = Value.Parse(pluginManifestSchema, JSON.parse(raw)) as PluginManifest;
    } catch (err) {
      skipped.push({ dir: entry.name, stage: "manifest", err });
      logger.warn({ plugin: entry.name, stage: "manifest", err }, "external capability plugin skipped");
      continue;
    }

    const mainAbs = path.resolve(pluginDirAbs, manifest.main);
    if (!isPathInside(pluginDirAbs, mainAbs)) {
      const err = new Error(`manifest.main escapes plugin directory: ${manifest.main}`);
      skipped.push({ dir: entry.name, stage: "path-escape", err });
      logger.warn({ plugin: entry.name, stage: "path-escape", err }, "external capability plugin skipped");
      continue;
    }

    let imported: unknown;
    try {
      imported = await import(pathToFileURL(mainAbs).href);
    } catch (err) {
      skipped.push({ dir: entry.name, stage: "import", err });
      logger.warn({ plugin: entry.name, stage: "import", err }, "external capability plugin skipped");
      continue;
    }

    const defaultExport = (imported as { default?: unknown }).default;
    const capability = checkCapabilityShape(defaultExport);
    if (capability === undefined) {
      const err = new Error("default export does not match Capability shape");
      skipped.push({ dir: entry.name, stage: "shape", err });
      logger.warn({ plugin: entry.name, stage: "shape", err }, "external capability plugin skipped");
      continue;
    }

    if (seenIds.has(capability.id)) {
      const err = new Error(`duplicate capability id: ${capability.id}`);
      skipped.push({ dir: entry.name, stage: "id-conflict", err });
      logger.warn({ plugin: entry.name, stage: "id-conflict", err }, "external capability plugin skipped");
      continue;
    }
    seenIds.add(capability.id);

    capabilities.push(wrapInit(capability, manifest));
  }

  return { capabilities, skipped };
}
