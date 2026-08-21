import type { Manifest, ManifestHealth, ManifestMutation, ManifestQuery } from "./types.js";
import { stripReservedKeys } from "./dot-path.js";

const SHAPE_SAMPLE_COUNT = 5;
const ENUM_PROBE_LIMIT = 8;
const OUTLINE_MAX_LENGTH = 4096;

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function describeEnum(values: string[]): string {
  const shown = values.slice(0, 4).join("|");
  return values.length > 4 ? `${shown}|…` : shown;
}

function probeStringEnum(rows: Row[], field: string): string | null {
  const distinct = new Set<string>();
  let probed = 0;
  for (const row of rows) {
    const v = row[field];
    if (v === undefined) return null;
    if (typeof v !== "string") return null;
    distinct.add(v);
    if (distinct.size > ENUM_PROBE_LIMIT) return null;
    probed += 1;
  }
  if (distinct.size < 2 || distinct.size >= probed) return null;
  return describeEnum([...distinct]);
}

type Row = Record<string, unknown>;

function describeArray(arr: unknown[]): string {
  const objectRows = arr.filter((r): r is Row => typeof r === "object" && r !== null && !Array.isArray(r));
  if (objectRows.length > 0 && objectRows.length === arr.length) {
    const fields = new Map<string, string>();
    const probeRows = objectRows.slice(0, SHAPE_SAMPLE_COUNT);
    for (const row of probeRows) {
      for (const [k, v] of Object.entries(row)) {
        if (k.startsWith("$")) continue;
        if (!fields.has(k)) fields.set(k, typeName(v));
      }
    }
    const shape = [...fields.entries()].map(([k, t]) => `${k}: ${t}`).join(", ");
    return `array[${arr.length}] of object { ${shape} }`;
  }
  if (arr.length > 0) {
    const first = typeName(arr[0]);
    const allSame = arr.every((v) => typeName(v) === first);
    if (allSame) return `array[${arr.length}] of ${first}`;
  }
  return `array[${arr.length}]`;
}

function describeValue(value: unknown, depth: number): string {
  if (Array.isArray(value)) return describeArray(value);
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).filter(([k]) => !k.startsWith("$"));
    if (depth >= 2 || entries.length === 0) return "object";
    const inner = entries
      .slice(0, 8)
      .map(([k, v]) => `${k}: ${describeValue(v, depth + 1)}`)
      .join(", ");
    return `object { ${inner}${entries.length > 8 ? ", …" : ""} }`;
  }
  return typeName(value);
}

export function formatEntrySignature(
  kind: "query" | "mutation",
  name: string,
  entry: ManifestQuery | ManifestMutation,
): string {
  if (kind === "query") {
    const q = entry as ManifestQuery;
    const parts: string[] = [];
    if (q.identity) parts.push(`${q.identity}?`);
    for (const pname of Object.keys(q.params ?? {})) {
      parts.push(`${pname}?`);
    }
    return `  query: ${name}(${parts.join(", ")}) → ${q.path}`;
  }
  const m = entry as ManifestMutation;
  const required: string[] = [];
  const optional: string[] = [];
  if (m.match) required.push(m.match);
  for (const [fname, rule] of Object.entries(m.fields ?? {})) {
    (rule.required ? required : optional).push(fname);
  }
  const params = [...required.map((n) => `${n}!`), ...optional.map((n) => `${n}?`)];
  return `  mutation: ${name}(${params.join(", ")}) → ${m.op} ${m.path}`;
}

function formatManifestSection(manifest: Manifest | null, health: ManifestHealth): string {
  if (!manifest) {
    if (health.status === "invalid") return "$manifest: present but unparsable (consider re-embedding via write_file)";
    return "$manifest: absent — no named query/mutation entries. Use read_data(path) for local reads; writes require edit_file/write_file (fallback path).";
  }
  const lines: string[] = [`$manifest: ${health.status}`];
  const queryNames = Object.keys(manifest.queries).sort();
  const mutationNames = Object.keys(manifest.mutations).sort();
  if (queryNames.length === 0 && mutationNames.length === 0) {
    lines.push("  (no entries declared)");
  }
  for (const name of queryNames) {
    if (health.staleQueries.includes(name)) {
      lines.push(`  query: ${name} [STALE: path missing]`);
      continue;
    }
    lines.push(formatEntrySignature("query", name, manifest.queries[name]));
  }
  for (const name of mutationNames) {
    if (health.staleMutations.includes(name)) {
      lines.push(`  mutation: ${name} [STALE: path missing]`);
      continue;
    }
    lines.push(formatEntrySignature("mutation", name, manifest.mutations[name]));
  }
  return lines.join("\n");
}

export function buildOutline(
  doc: Record<string, unknown>,
  opts: { file: string; version: string; sizeBytes: number; manifest: Manifest | null; health: ManifestHealth },
): string {
  const lines: string[] = [];
  const sizeLabel = opts.sizeBytes < 1024 ? `${opts.sizeBytes}B` : `${(opts.sizeBytes / 1024).toFixed(1)}KB`;
  lines.push(`$outline of ${opts.file} (${sizeLabel}, version ${opts.version.slice(0, 12)}…)`);
  lines.push("");

  const business = stripReservedKeys(doc);
  const enumProbes = new Map<string, string | null>();
  for (const [key, value] of Object.entries(business)) {
    if (Array.isArray(value)) {
      const rows = value.filter((r): r is Row => typeof r === "object" && r !== null && !Array.isArray(r));
      if (rows.length > 0 && rows.length === value.length) {
        for (const field of Object.keys(rows[0]).slice(0, 12)) {
          enumProbes.set(`${key}.${field}`, probeStringEnum(rows.slice(0, 20), field));
        }
      }
    }
  }

  for (const [key, value] of Object.entries(business)) {
    const desc = describeValue(value, 0);
    if (desc.startsWith("array") && desc.includes("of object")) {
      const probes = [...enumProbes.entries()]
        .filter(([k]) => k.startsWith(`${key}.`))
        .map(([k, v]) => (v ? `${k.slice(key.length + 1)}: ${v}` : null))
        .filter((v): v is string => v !== null);
      lines.push(`- ${key}: ${desc}${probes.length > 0 ? ` — enums: ${probes.join("; ")}` : ""}`);
    } else {
      lines.push(`- ${key}: ${desc}`);
    }
  }

  lines.push("");
  lines.push(formatManifestSection(opts.manifest, opts.health));

  let outline = lines.join("\n");
  if (outline.length > OUTLINE_MAX_LENGTH) {
    const suffix = "\n… (outline truncated)";
    outline = `${outline.slice(0, OUTLINE_MAX_LENGTH - suffix.length)}${suffix}`;
  }
  return outline;
}
