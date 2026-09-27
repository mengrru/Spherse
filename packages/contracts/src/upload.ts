import { Type, type Static } from "@sinclair/typebox";

export const schemas = {
  uploadResponse: Type.Object({
    path: Type.String(),
    bytes: Type.Integer(),
    renamed: Type.Boolean(),
  }),
} as const;

export type UploadResponse = Static<typeof schemas.uploadResponse>;
