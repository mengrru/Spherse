import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const schemas = {
  okResponse: Type.Object({ ok: Type.Boolean() }),
  errorResponse: Type.Object({ error: Type.String() }),
} as const;

export type OkResponse = Static<typeof schemas.okResponse>;
export type ErrorResponse = Static<typeof schemas.errorResponse>;

export function parseContract<T extends TSchema>(schema: T, payload: unknown): Static<T> {
  if (!Value.Check(schema, payload)) {
    const firstError = [...Value.Errors(schema, payload)][0];
    const message = firstError?.message ?? "unknown validation error";
    throw new Error(`Invalid payload: ${message}`);
  }
  return Value.Parse(schema, payload);
}

export function parseApiResponse<T extends TSchema>(schema: T, payload: unknown): Static<T> {
  return parseContract(schema, payload);
}
