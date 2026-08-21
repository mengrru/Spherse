export { createDataStore, type CreateDataStoreOptions } from "./data-store.js";
export { parseManifest, readManifestFromDoc, checkManifestHealth, dataManifestSchema } from "./manifest.js";
export { getByDotPath, getRawByDotPath, stripReservedKeys } from "./dot-path.js";
export { runQuery, decodeCursor } from "./query-engine.js";
export { buildOutline, formatEntrySignature } from "./outline.js";
export { OutlineCache } from "./outline-cache.js";
export { resolveDataFile, isReservedKey } from "./path-guard.js";
export { validateMutationArgs, validateQueryParams } from "./validate.js";
export { createReadDataTool, createQueryDataTool, createMutateDataTool } from "./tools.js";
export { dataCapability } from "./capability.js";
export type {
  DataStore,
  DataChangeEvent,
  DataOrigin,
  Manifest,
  ManifestQuery,
  ManifestMutation,
  ManifestHealth,
  OutlineResult,
  ReadResult,
  QueryResult,
  MutateResult,
  WriteResult,
} from "./types.js";
export {
  VersionConflictError,
  ManifestStaleError,
  UnknownEntryError,
  DataValidationError,
  DataFileCorruptedError,
  ForbiddenKeyError,
} from "./types.js";
