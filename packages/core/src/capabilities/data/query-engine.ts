import type { ManifestParam, ManifestQuery, QueryResult } from "./types.js";
import { getByDotPath } from "./dot-path.js";
import { validateQueryParams } from "./validate.js";

export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 20;
const ITEM_TRUNCATE_BYTES = 4 * 1024;

type Row = Record<string, unknown>;

function isObjectRow(r: unknown): r is Row {
  return typeof r === "object" && r !== null && !Array.isArray(r);
}

function encodeCursor(value: string | number): string {
  return Buffer.from(String(value), "utf8").toString("base64");
}

export function decodeCursor(cursor: string): string | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cursor)) return null;
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

function truncateLargeItems(rows: unknown[]): { rows: unknown[]; truncated: number[] } {
  const truncated: number[] = [];
  const out = rows.map((row, i) => {
    const serialized = JSON.stringify(row);
    if (serialized !== undefined && serialized.length > ITEM_TRUNCATE_BYTES) {
      truncated.push(i);
      return { _truncated: true, _preview: serialized.slice(0, 512), _sizeBytes: serialized.length };
    }
    return row;
  });
  return { rows: out, truncated };
}

function compareRows(a: unknown, b: unknown, field: string, dir: "asc" | "desc"): number {
  const av = isObjectRow(a) ? a[field] : undefined;
  const bv = isObjectRow(b) ? b[field] : undefined;
  let cmp: number;
  if (av === bv) cmp = 0;
  else if (av === undefined) cmp = -1;
  else if (bv === undefined) cmp = 1;
  else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
  else cmp = String(av) < String(bv) ? -1 : 1;
  return dir === "asc" ? cmp : -cmp;
}

function isOperatorParam(name: string, rule: ManifestParam | undefined): boolean {
  if (name === "sort") return rule?.type === "field";
  if (name === "dir") return rule?.type === "enum" && !!rule.values && rule.values.every((v) => v === "asc" || v === "desc");
  return false;
}

export function runQuery(
  doc: Record<string, unknown>,
  query: ManifestQuery,
  params: Record<string, unknown>,
  page?: { limit?: number; after?: string; offset?: number },
): QueryResult {
  const { values, identityValue } = validateQueryParams(query, params);
  const target = getByDotPath(doc, query.path);
  if (target.missing || !Array.isArray(target.value)) {
    return {
      version: "",
      value: [],
      total: 0,
      count: 0,
      pagination: "cursor",
      note: `path "${query.path}" not found or not an array`,
    };
  }

  const rows: unknown[] = target.value;

  let filtered = rows;
  for (const [name, val] of Object.entries(values)) {
    if (query.identity && name === query.identity) continue;
    const paramRule = query.params?.[name];
    if (isOperatorParam(name, paramRule)) continue;
    filtered = filtered.filter((r) => isObjectRow(r) && r[name] === val);
  }
  if (identityValue !== undefined && query.identity) {
    filtered = filtered.filter((r) => isObjectRow(r) && r[query.identity!] === identityValue);
  }

  const sortField = typeof values.sort === "string" ? values.sort : undefined;
  if (sortField) {
    const dir = values.dir === "asc" ? "asc" : "desc";
    filtered = [...filtered].sort((a, b) => compareRows(a, b, sortField, dir));
  }

  const total = filtered.length;
  const limit = Math.min(Math.max(page?.limit ?? query.defaultLimit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);

  let pageRows: unknown[];
  let pagination: "cursor" | "offset-drift" = "cursor";
  let nextAfter: string | undefined;

  if (query.identity) {
    let start = 0;
    if (page?.after !== undefined) {
      const cursorValue = decodeCursor(page.after);
      if (cursorValue === null) {
        return { version: "", value: [], total, count: 0, pagination };
      }
      const idx = filtered.findIndex((r) => isObjectRow(r) && String(r[query.identity!]) === cursorValue);
      start = idx >= 0 ? idx + 1 : filtered.length;
    }
    pageRows = filtered.slice(start, start + limit);
    const lastRow = pageRows[pageRows.length - 1];
    if (start + limit < total && isObjectRow(lastRow)) {
      nextAfter = encodeCursor(lastRow[query.identity!] as string | number);
    }
  } else {
    const offset = Math.max(page?.offset ?? 0, 0);
    pagination = "offset-drift";
    pageRows = filtered.slice(offset, offset + limit);
  }

  const { rows: safeRows, truncated } = truncateLargeItems(pageRows);
  const result: QueryResult = {
    version: "",
    value: safeRows,
    total,
    count: safeRows.length,
    pagination,
  };
  if (nextAfter) result.nextAfter = nextAfter;
  if (truncated.length > 0) result.truncatedItems = truncated;
  return result;
}
