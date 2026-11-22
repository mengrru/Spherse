import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const schemas = {
  okResponse: Type.Object({ ok: Type.Boolean() }),
  errorResponse: Type.Object({ error: Type.String() }),
} as const;

export type OkResponse = Static<typeof schemas.okResponse>;
export type ErrorResponse = Static<typeof schemas.errorResponse>;

export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) out[key] = stripUndefined(entry);
    }
    return out as T;
  }
  return value;
}

export function parseContract<T extends TSchema>(schema: T, payload: unknown): Static<T> {
  const jsonSafe = stripUndefined(payload);
  if (!Value.Check(schema, jsonSafe)) {
    const firstError = [...Value.Errors(schema, jsonSafe)][0];
    const message = firstError?.message ?? "unknown validation error";
    throw new Error(`Invalid payload: ${message}`);
  }
  return Value.Parse(schema, jsonSafe);
}

export function parseApiResponse<T extends TSchema>(schema: T, payload: unknown): Static<T> {
  return parseContract(schema, payload);
}
