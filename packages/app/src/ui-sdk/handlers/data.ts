import type { ApiClient } from "../../lib/api";
import { registerAction } from "../registry";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

function validateFileParam(file: unknown): string | null {
  if (typeof file !== "string" || !file) return null;
  if (!file.endsWith(".data.json")) return null;
  if (file.startsWith(".spherse/") || file.startsWith(".spherse\\") || file === ".spherse") return null;
  return file;
}

async function readDataJson(client: ApiClient, dataFilePath: string): Promise<Record<string, unknown>> {
  const res = await client.getContent(dataFilePath);
  if (!res) return {};
  try {
    const parsed = JSON.parse(res.content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeDataJson(client: ApiClient, dataFilePath: string, data: Record<string, unknown>): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  if (new TextEncoder().encode(content).length > MAX_FILE_SIZE) {
    throw new Error("Data file exceeds 20MB limit");
  }
  await client.saveContent(dataFilePath, content);
}

function respond(source: MessageEventSource, requestId: string, ok: boolean, data?: unknown) {
  (source as WindowProxy).postMessage({ type: "spherse:response", requestId, ok, data }, "*");
}

registerAction("data.get", async (params, ctx) => {
  const { file, key } = params as { file: unknown; key: unknown };
  const requestId = ctx.requestId;
  const validFile = validateFileParam(file);
  if (!validFile || !key || typeof key !== "string" || !requestId || !ctx.source || !ctx.client) return;

  try {
    const json = await readDataJson(ctx.client, validFile);
    const value = key in json ? json[key] : null;
    respond(ctx.source, requestId, true, value);
  } catch {
    respond(ctx.source, requestId, false);
  }
});

registerAction("data.set", async (params, ctx) => {
  const { file, key, value } = params as { file: unknown; key: unknown; value: unknown };
  const requestId = ctx.requestId;
  const validFile = validateFileParam(file);
  if (!validFile || !key || typeof key !== "string" || value === undefined || !requestId || !ctx.source || !ctx.client) return;

  try {
    const json = await readDataJson(ctx.client, validFile);
    json[key] = value;
    await writeDataJson(ctx.client, validFile, json);
    respond(ctx.source, requestId, true, value);
  } catch {
    respond(ctx.source, requestId, false);
  }
});

registerAction("data.delete", async (params, ctx) => {
  const { file, key } = params as { file: unknown; key: unknown };
  const requestId = ctx.requestId;
  const validFile = validateFileParam(file);
  if (!validFile || !key || typeof key !== "string" || !requestId || !ctx.source || !ctx.client) return;

  try {
    const json = await readDataJson(ctx.client, validFile);
    delete json[key];
    await writeDataJson(ctx.client, validFile, json);
    respond(ctx.source, requestId, true, true);
  } catch {
    respond(ctx.source, requestId, false);
  }
});
