export type DataOrigin = "sdk" | "agent";

export interface DataChangeEvent {
  file: string;
  version: string;
  origin: DataOrigin;
  summary?: string;
}

export class VersionConflictError extends Error {
  constructor(public currentVersion: string) {
    super("version conflict");
    this.name = "VersionConflictError";
  }
}

export class ManifestStaleError extends Error {
  constructor(
    public entry: string,
    public kind: "query" | "mutation",
    public validNames: string[],
  ) {
    super(`manifest entry stale: ${entry}`);
    this.name = "ManifestStaleError";
  }
}

export class UnknownEntryError extends Error {
  constructor(
    public entry: string,
    public kind: "query" | "mutation",
    public validNames: string[],
  ) {
    super(`unknown manifest entry: ${entry}`);
    this.name = "UnknownEntryError";
  }
}

export class DataValidationError extends Error {
  constructor(
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "DataValidationError";
  }
}

export class DataFileCorruptedError extends Error {
  constructor(public file: string) {
    super(`data file corrupted (unparsable JSON): ${file}`);
    this.name = "DataFileCorruptedError";
  }
}

export class ForbiddenKeyError extends Error {
  constructor(public key: string) {
    super(`key with "$" prefix is reserved: ${key}`);
    this.name = "ForbiddenKeyError";
  }
}

export type ManifestParamType = "enum" | "field" | "string" | "integer" | "boolean";

export interface ManifestParam {
  type: ManifestParamType;
  values?: string[];
  default?: string;
  desc?: string;
}

export interface ManifestFieldRule {
  type: "string" | "integer" | "number" | "boolean" | "enum";
  values?: string[];
  required?: boolean;
  default?: unknown;
  desc?: string;
}

export interface ManifestQuery {
  desc?: string;
  path: string;
  identity?: string;
  params?: Record<string, ManifestParam>;
  defaultLimit?: number;
}

export type MutationOp = "append" | "update" | "remove" | "set";

export interface ManifestMutation {
  desc?: string;
  op: MutationOp;
  path: string;
  match?: string;
  fields?: Record<string, ManifestFieldRule>;
  auto?: Record<string, "uuid" | "nowIso">;
}

export interface Manifest {
  version: number;
  desc?: string;
  queries: Record<string, ManifestQuery>;
  mutations: Record<string, ManifestMutation>;
}

export interface ManifestHealth {
  status: "healthy" | "stale" | "absent" | "invalid";
  staleQueries: string[];
  staleMutations: string[];
}

export interface OutlineResult {
  file: string;
  sizeBytes: number;
  version: string;
  outline: string;
  health: ManifestHealth;
}

export interface ReadResult {
  version: string;
  unchanged?: boolean;
  value?: unknown;
  total?: number;
  offset?: number;
  limit?: number;
  truncated?: boolean;
  note?: string;
}

export interface QueryResult {
  version: string;
  value: unknown;
  total: number;
  count: number;
  pagination: "cursor" | "offset-drift";
  nextAfter?: string;
  truncatedItems?: number[];
  note?: string;
}

export interface MutateResult {
  version: string;
  result: unknown;
}

export interface WriteResult {
  version: string;
}

export interface DataStore {
  outline(file: string): Promise<OutlineResult>;
  read(file: string, opts: { key?: string; path?: string; offset?: number; limit?: number; ifVersion?: string }): Promise<ReadResult>;
  query(file: string, name: string, params?: Record<string, unknown>, page?: { limit?: number; after?: string }): Promise<QueryResult>;
  mutate(file: string, name: string, args: Record<string, unknown>, opts?: { idempotencyKey?: string; origin?: DataOrigin }): Promise<MutateResult>;
  rawSet(file: string, key: string, value: unknown, opts?: { ifVersion?: string }): Promise<WriteResult>;
  rawDelete(file: string, key: string, opts?: { ifVersion?: string }): Promise<WriteResult>;
  onChange(handler: (e: DataChangeEvent) => void): () => void;
}
