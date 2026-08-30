import { Type, type Static } from "@sinclair/typebox";

export const contextFileStatSchema = Type.Object({
  path: Type.String(),
  exists: Type.Boolean(),
  sizeBytes: Type.Integer({ minimum: 0 }),
  allowed: Type.Boolean(),
});

export const schemas = {
  contextFilesInspectRequest: Type.Object({
    paths: Type.Array(Type.String(), { maxItems: 1000 }),
  }),
  contextFilesInspectResponse: Type.Object({
    files: Type.Array(contextFileStatSchema),
  }),
} as const;

export type ContextFilesInspectRequest = Static<typeof schemas.contextFilesInspectRequest>;
export type ContextFilesInspectResponse = Static<typeof schemas.contextFilesInspectResponse>;
export type ContextFileStatContract = Static<typeof contextFileStatSchema>;
