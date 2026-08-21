import { Type, type Static } from "@sinclair/typebox";
import type { Manifest, ManifestHealth, ManifestMutation, ManifestQuery } from "./types.js";
import { getByDotPath } from "./dot-path.js";

const manifestParamSchema = Type.Object({
  type: Type.Union([Type.Literal("enum"), Type.Literal("field"), Type.Literal("string"), Type.Literal("integer"), Type.Literal("boolean")]),
  values: Type.Optional(Type.Array(Type.String(), { maxItems: 32 })),
  default: Type.Optional(Type.String()),
  desc: Type.Optional(Type.String()),
});

const manifestFieldRuleSchema = Type.Object({
  type: Type.Union([
    Type.Literal("string"),
    Type.Literal("integer"),
    Type.Literal("number"),
    Type.Literal("boolean"),
    Type.Literal("enum"),
  ]),
  values: Type.Optional(Type.Array(Type.String(), { maxItems: 32 })),
  required: Type.Optional(Type.Boolean()),
  default: Type.Optional(Type.Unknown()),
  desc: Type.Optional(Type.String()),
});

const manifestQuerySchema = Type.Object({
  desc: Type.Optional(Type.String()),
  path: Type.String({ minLength: 1 }),
  identity: Type.Optional(Type.String({ minLength: 1 })),
  params: Type.Optional(Type.Record(Type.String(), manifestParamSchema)),
  defaultLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});

const manifestMutationSchema = Type.Object({
  desc: Type.Optional(Type.String()),
  op: Type.Union([Type.Literal("append"), Type.Literal("update"), Type.Literal("remove"), Type.Literal("set")]),
  path: Type.String({ minLength: 1 }),
  match: Type.Optional(Type.String({ minLength: 1 })),
  fields: Type.Optional(Type.Record(Type.String(), manifestFieldRuleSchema)),
  auto: Type.Optional(Type.Record(Type.String(), Type.Union([Type.Literal("uuid"), Type.Literal("nowIso")]))),
});

export const dataManifestSchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  desc: Type.Optional(Type.String()),
  queries: Type.Optional(Type.Record(Type.String(), manifestQuerySchema)),
  mutations: Type.Optional(Type.Record(Type.String(), manifestMutationSchema)),
});

type ManifestShape = Static<typeof dataManifestSchema>;

const MANIFEST_SUPPORTED_VERSION = 1;

export function parseManifest(value: unknown): Manifest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const shape = value as Partial<ManifestShape>;
  if (typeof shape.version !== "number" || shape.version > MANIFEST_SUPPORTED_VERSION) return null;
  if (shape.queries !== undefined && (typeof shape.queries !== "object" || shape.queries === null || Array.isArray(shape.queries))) return null;
  if (shape.mutations !== undefined && (typeof shape.mutations !== "object" || shape.mutations === null || Array.isArray(shape.mutations))) return null;

  const queries: Record<string, ManifestQuery> = {};
  for (const [name, q] of Object.entries(shape.queries ?? {})) {
    if (!q || typeof q.path !== "string" || !q.path) continue;
    queries[name] = {
      desc: q.desc,
      path: q.path,
      identity: q.identity,
      params: q.params,
      defaultLimit: q.defaultLimit,
    };
  }

  const mutations: Record<string, ManifestMutation> = {};
  for (const [name, m] of Object.entries(shape.mutations ?? {})) {
    if (!m || typeof m.path !== "string" || !m.path) continue;
    if (m.op !== "append" && m.op !== "update" && m.op !== "remove" && m.op !== "set") continue;
    mutations[name] = {
      desc: m.desc,
      op: m.op,
      path: m.path,
      match: m.match,
      fields: m.fields,
      auto: m.auto,
    };
  }

  return {
    version: shape.version,
    desc: shape.desc,
    queries,
    mutations,
  };
}

export function readManifestFromDoc(doc: Record<string, unknown>): Manifest | null {
  const raw = doc.$manifest;
  if (raw === undefined) return null;
  return parseManifest(raw);
}

export function checkManifestHealth(doc: Record<string, unknown>, manifest: Manifest | null): ManifestHealth {
  if (!manifest) {
    const rawPresent = doc.$manifest !== undefined;
    return {
      status: rawPresent ? "invalid" : "absent",
      staleQueries: [],
      staleMutations: [],
    };
  }
  const staleQueries: string[] = [];
  const staleMutations: string[] = [];
  for (const [name, q] of Object.entries(manifest.queries)) {
    if (getByDotPath(doc, q.path).missing) staleQueries.push(name);
  }
  for (const [name, m] of Object.entries(manifest.mutations)) {
    if (getByDotPath(doc, m.path).missing) staleMutations.push(name);
  }
  return {
    status: staleQueries.length > 0 || staleMutations.length > 0 ? "stale" : "healthy",
    staleQueries,
    staleMutations,
  };
}
