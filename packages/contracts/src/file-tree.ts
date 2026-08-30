import { Type, type Static } from "@sinclair/typebox";

export const schemas = {
  fileTreeResponse: Type.Array(Type.String()),
} as const;

export type FileTreeResponse = Static<typeof schemas.fileTreeResponse>;
