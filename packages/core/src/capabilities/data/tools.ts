import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AccessPolicyProvider } from "../../access/access-policy.js";
import type { DataStore } from "./types.js";
import {
  DataFileCorruptedError,
  DataValidationError,
  ForbiddenKeyError,
  ManifestStaleError,
  UnknownEntryError,
  VersionConflictError,
} from "./types.js";

const READ_DATA_GUIDE =
  "Structured access to *.data.json data files. First contact with a file: call without path/key to get its outline (structure + named query/mutation entries). " +
  "Then use query_data/mutate_data with the entry names from the outline. " +
  "Without $manifest: read with path (dot-path, arrays are paginated via offset/limit) and edit via edit_file/write_file as fallback. " +
  "ifVersion returns unchanged:true when the file has not changed since that version (sha256), saving context on re-reads.";

function errorText(err: unknown): string {
  if (err instanceof VersionConflictError) {
    return `Error: version conflict — file changed since the version you saw. Current version: ${err.currentVersion}. Re-read and retry.`;
  }
  if (err instanceof ManifestStaleError) {
    return `Error: manifest entry "${err.entry}" is stale (its path no longer resolves). Valid entries: ${err.validNames.join(", ") || "none"}. Call read_data without path to see the current outline.`;
  }
  if (err instanceof UnknownEntryError) {
    return `Error: unknown ${err.kind} entry "${err.entry}". Valid entries: ${err.validNames.join(", ") || "none"}. Call read_data without path to see the outline.`;
  }
  if (err instanceof DataValidationError) {
    return `Error: ${err.message}`;
  }
  if (err instanceof ForbiddenKeyError) {
    return `Error: ${err.message}`;
  }
  if (err instanceof DataFileCorruptedError) {
    return `Error: data file is corrupted (unparsable JSON): ${err.file}. It is NOT auto-repaired — report this to the user.`;
  }
  return `Error: ${(err as Error).message}`;
}

function jsonBlock(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

const ReadDataParams = Type.Object({
  file: Type.String({ description: "Path of the *.data.json file, relative to project root" }),
  key: Type.Optional(Type.String({ description: "Literal top-level key to read (dots are NOT path separators). Mutually exclusive with path" })),
  path: Type.Optional(Type.String({ description: "Dot-path to a value inside the document. Omit to get the outline. \".\" returns the whole document without $-prefixed keys" })),
  offset: Type.Optional(Type.Integer({ minimum: 0, description: "Array slice start when reading an array path (default 0)" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Array slice size when reading an array path (default 20)" })),
  ifVersion: Type.Optional(Type.String({ description: "Version you previously saw. If unchanged, returns { unchanged: true } without the data" })),
});

export function createReadDataTool(dataStore: DataStore, getPolicy: AccessPolicyProvider): AgentTool<typeof ReadDataParams> {
  return {
    name: "read_data",
    label: "Read Data",
    description: READ_DATA_GUIDE,
    parameters: ReadDataParams,
    async execute(_toolCallId, params, _signal) {
      try {
        getPolicy().assertRead(params.file);
      } catch (err) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], details: { path: params.file, denied: true } };
      }
      try {
        const result = await dataStore.read(params.file, params);
        return {
          content: [{ type: "text" as const, text: jsonBlock(result) }],
          details: { path: params.file, version: result.version },
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: errorText(err) }], details: { path: params.file, error: true } };
      }
    },
  };
}

const QueryDataParams = Type.Object({
  file: Type.String({ description: "Path of the *.data.json file, relative to project root" }),
  name: Type.String({ description: "Query entry name declared in the file's $manifest (see outline from read_data)" }),
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Query parameters as declared in the outline (enum filters, sort, dir, identity value)" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Page size (default from manifest, else 20)" })),
  after: Type.Optional(Type.String({ description: "Cursor from a previous result's nextAfter for stable pagination" })),
});

export function createQueryDataTool(dataStore: DataStore, getPolicy: AccessPolicyProvider): AgentTool<typeof QueryDataParams> {
  return {
    name: "query_data",
    label: "Query Data",
    description:
      "Run a named query from a *.data.json $manifest (one hop to business-meaningful data). Entry names and params are listed in the outline returned by read_data.",
    parameters: QueryDataParams,
    async execute(_toolCallId, params, _signal) {
      try {
        getPolicy().assertRead(params.file);
      } catch (err) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], details: { path: params.file, denied: true } };
      }
      try {
        const result = await dataStore.query(params.file, params.name, params.params ?? {}, {
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
          ...(params.after !== undefined ? { after: params.after } : {}),
        });
        return {
          content: [{ type: "text" as const, text: jsonBlock(result) }],
          details: { path: params.file, version: result.version },
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: errorText(err) }], details: { path: params.file, error: true } };
      }
    },
  };
}

const MutateDataParams = Type.Object({
  file: Type.String({ description: "Path of the *.data.json file, relative to project root" }),
  name: Type.String({ description: "Mutation entry name declared in the file's $manifest (see outline from read_data)" }),
  args: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Mutation arguments as declared in the outline (! = required). Identity/match fields are passed by name" })),
  idempotencyKey: Type.Optional(Type.String({ description: "Unique key to make retries safe: same key returns the original result instead of executing again (e.g. session:run:n)" })),
});

export function createMutateDataTool(dataStore: DataStore, getPolicy: AccessPolicyProvider): AgentTool<typeof MutateDataParams> {
  return {
    name: "mutate_data",
    label: "Mutate Data",
    description:
      "Run a named mutation from a *.data.json $manifest (append/update/remove/set with schema validation and auto-generated fields). Atomic and safe to retry with idempotencyKey.",
    parameters: MutateDataParams,
    async execute(_toolCallId, params, _signal) {
      try {
        getPolicy().assertWrite(params.file);
      } catch (err) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], details: { path: params.file, denied: true } };
      }
      try {
        const result = await dataStore.mutate(params.file, params.name, params.args ?? {}, {
          ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}),
        });
        return {
          content: [{ type: "text" as const, text: jsonBlock(result) }],
          details: { path: params.file, version: result.version },
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: errorText(err) }], details: { path: params.file, error: true } };
      }
    },
  };
}
