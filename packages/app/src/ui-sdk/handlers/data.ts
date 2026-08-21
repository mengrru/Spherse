import { registerAction } from "../registry";
import { respond } from "../respond";

function validateFileParam(file: unknown): string | null {
  if (typeof file !== "string" || !file) return null;
  if (!file.endsWith(".data.json")) return null;
  if (file.startsWith(".spherse/") || file.startsWith(".spherse\\") || file === ".spherse") return null;
  return file;
}

function validateKeyParam(key: unknown): string | null {
  if (typeof key !== "string" || !key) return null;
  return key;
}

function isReservedKey(key: string): boolean {
  return key.startsWith("$");
}

registerAction("data.get", async (params, ctx) => {
  const { file, key } = params as { file: unknown; key: unknown };
  const validFile = validateFileParam(file);
  const validKey = validateKeyParam(key);
  if (!validFile || !validKey || !ctx.client) return;
  if (isReservedKey(validKey)) {
    respond(ctx, false);
    return;
  }

  try {
    const r = await ctx.client.dataRead({ file: validFile, key: validKey });
    respond(ctx, true, r.value === undefined ? null : r.value);
  } catch {
    respond(ctx, false);
  }
});

registerAction("data.set", async (params, ctx) => {
  const { file, key, value } = params as { file: unknown; key: unknown; value: unknown };
  const validFile = validateFileParam(file);
  const validKey = validateKeyParam(key);
  if (!validFile || !validKey || value === undefined || !ctx.client) return;
  if (isReservedKey(validKey)) {
    respond(ctx, false);
    return;
  }

  try {
    await ctx.client.dataRawSet({ file: validFile, key: validKey, value });
    respond(ctx, true, value);
  } catch {
    respond(ctx, false);
  }
});

registerAction("data.delete", async (params, ctx) => {
  const { file, key } = params as { file: unknown; key: unknown };
  const validFile = validateFileParam(file);
  const validKey = validateKeyParam(key);
  if (!validFile || !validKey || !ctx.client) return;
  if (isReservedKey(validKey)) {
    respond(ctx, false);
    return;
  }

  try {
    await ctx.client.dataRawDelete({ file: validFile, key: validKey });
    respond(ctx, true, true);
  } catch {
    respond(ctx, false);
  }
});

registerAction("data.mutate", async (params, ctx) => {
  const { file, name, args, idempotencyKey } = params as {
    file: unknown;
    name: unknown;
    args?: unknown;
    idempotencyKey?: unknown;
  };
  const validFile = validateFileParam(file);
  if (!validFile || typeof name !== "string" || !name || !ctx.client) return;

  try {
    const r = await ctx.client.dataMutate({
      file: validFile,
      name,
      ...(typeof args === "object" && args !== null && !Array.isArray(args) ? { args: args as Record<string, unknown> } : {}),
      ...(typeof idempotencyKey === "string" && idempotencyKey ? { idempotencyKey } : {}),
    });
    respond(ctx, true, r.result);
  } catch {
    respond(ctx, false);
  }
});

registerAction("data.keys", async (params, ctx) => {
  const { file } = params as { file: unknown };
  const validFile = validateFileParam(file);
  if (!validFile || !ctx.client) return;

  try {
    const r = await ctx.client.dataRead({ file: validFile, path: "." });
    const doc = (r.value ?? {}) as Record<string, unknown>;
    respond(ctx, true, Object.keys(doc));
  } catch {
    respond(ctx, false);
  }
});

registerAction("data.entries", async (params, ctx) => {
  const { file } = params as { file: unknown };
  const validFile = validateFileParam(file);
  if (!validFile || !ctx.client) return;

  try {
    const r = await ctx.client.dataRead({ file: validFile, path: "." });
    respond(ctx, true, (r.value ?? {}) as Record<string, unknown>);
  } catch {
    respond(ctx, false);
  }
});
