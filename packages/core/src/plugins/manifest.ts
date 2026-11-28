import { Type, type Static } from "@sinclair/typebox";

export const pluginManifestSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  version: Type.String({ minLength: 1 }),
  main: Type.String({ minLength: 1 }),
  engines: Type.Optional(
    Type.Object({
      spherse: Type.Optional(Type.String()),
    }),
  ),
});

export type PluginManifest = Static<typeof pluginManifestSchema>;
