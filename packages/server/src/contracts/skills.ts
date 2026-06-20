import { Type, type Static } from "@sinclair/typebox";

const skillDefinition = Type.Object({
  name: Type.String(),
  description: Type.String(),
  instructions: Type.String(),
  filePath: Type.String(),
  source: Type.Union([Type.Literal("builtin"), Type.Literal("project")]),
});

export const schemas = {
  skillDefinition,
  skillListResponse: Type.Array(skillDefinition),
} as const;

export type SkillDefinitionContract = Static<typeof skillDefinition>;
export type SkillListResponse = Static<typeof schemas.skillListResponse>;
