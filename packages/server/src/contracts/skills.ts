import { Type, type Static } from "@sinclair/typebox";

const skillDefinition = Type.Object({
  name: Type.String(),
  description: Type.String(),
  instructions: Type.String(),
  filePath: Type.String(),
  source: Type.Union([Type.Literal("builtin"), Type.Literal("project")]),
  files: Type.Array(Type.String()),
  version: Type.Optional(Type.String()),
});

export const schemas = {
  skillDefinition,
  skillListResponse: Type.Array(skillDefinition),
  skillCreateRequest: Type.Object({
    name: Type.String(),
    description: Type.String(),
    instructions: Type.String(),
  }),
  skillInstallRequest: Type.Object({
    zipPath: Type.String(),
  }),
} as const;

export type SkillDefinitionContract = Static<typeof skillDefinition>;
export type SkillListResponse = Static<typeof schemas.skillListResponse>;
export type SkillCreateRequest = Static<typeof schemas.skillCreateRequest>;
export type SkillInstallRequest = Static<typeof schemas.skillInstallRequest>;
