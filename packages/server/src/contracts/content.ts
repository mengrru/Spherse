import { Type, type Static } from "@sinclair/typebox";

const fileEntry = Type.Object({
  name: Type.String(),
  type: Type.Union([Type.Literal("file"), Type.Literal("directory")]),
});

export const schemas = {
  fileEntry,
  fileEntries: Type.Array(fileEntry),
  contentResponse: Type.Object({
    content: Type.String(),
    path: Type.String(),
    binary: Type.Optional(Type.Boolean()),
  }),
  statResponse: Type.Object({
    size: Type.Number(),
    mtime: Type.Number(),
    isDirectory: Type.Boolean(),
  }),
  contentCreateRequest: Type.Object({
    action: Type.Union([Type.Literal("mkdir"), Type.Literal("touch")]),
  }),
  contentSaveRequest: Type.Object({ content: Type.String() }),
} as const;

export type FileEntryContract = Static<typeof fileEntry>;
export type FileEntriesResponse = Static<typeof schemas.fileEntries>;
export type ContentResponseContract = Static<typeof schemas.contentResponse>;
export type StatResponseContract = Static<typeof schemas.statResponse>;
export type ContentCreateRequest = Static<typeof schemas.contentCreateRequest>;
export type ContentSaveRequest = Static<typeof schemas.contentSaveRequest>;
