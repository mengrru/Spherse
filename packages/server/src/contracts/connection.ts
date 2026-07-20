import { Type, type Static } from "@sinclair/typebox";

const projectListEntry = Type.Object({
  id: Type.String(),
  name: Type.String(),
});

const projectInfoResponse = Type.Object({
  id: Type.String(),
  name: Type.String(),
  rootPath: Type.String(),
});

const connectionInfoResponse = Type.Object({
  serverVersion: Type.String(),
  authRequired: Type.Boolean(),
  apiVersion: Type.String(),
});

export const schemas = {
  projectListEntry,
  projectListResponse: Type.Array(projectListEntry),
  projectInfoResponse,
  connectionInfoResponse,
} as const;

export type ProjectListEntry = Static<typeof projectListEntry>;
export type ProjectListResponse = Static<typeof schemas.projectListResponse>;
export type ProjectInfoResponse = Static<typeof projectInfoResponse>;
export type ConnectionInfoResponse = Static<typeof connectionInfoResponse>;
