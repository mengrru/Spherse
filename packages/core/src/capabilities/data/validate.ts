import type { ManifestFieldRule, ManifestMutation, ManifestParam, ManifestQuery } from "./types.js";
import { DataValidationError } from "./types.js";

type FieldType = ManifestFieldRule["type"];

function checkValueType(value: unknown, type: FieldType, values?: string[]): string | null {
  switch (type) {
    case "string":
      return typeof value === "string" ? null : "expected string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value) ? null : "expected integer";
    case "number":
      return typeof value === "number" ? null : "expected number";
    case "boolean":
      return typeof value === "boolean" ? null : "expected boolean";
    case "enum":
      if (typeof value !== "string") return "expected string (enum)";
      if (values && !values.includes(value)) return `value must be one of: ${values.join(", ")}`;
      return null;
  }
}

export interface ValidatedFields {
  value: Record<string, unknown>;
}

export function validateMutationArgs(
  mutation: ManifestMutation,
  args: Record<string, unknown>,
): ValidatedFields {
  const errors: Record<string, string> = {};
  const value: Record<string, unknown> = {};

  const fields = mutation.fields ?? {};
  const auto = mutation.auto ?? {};

  for (const [name, rule] of Object.entries(fields)) {
    if (name in auto) {
      errors[name] = "field is declared both in fields and auto";
      continue;
    }
    if (args[name] === undefined) {
      if (rule.default !== undefined) {
        value[name] = rule.default;
        continue;
      }
      if (rule.required) {
        errors[name] = "required field missing";
      }
      continue;
    }
    const err = checkValueType(args[name], rule.type, rule.values);
    if (err) errors[name] = err;
    else value[name] = args[name];
  }

  for (const name of Object.keys(auto)) {
    if (name === mutation.match) continue;
    if (args[name] !== undefined) {
      errors[name] = "auto field must not be provided (it is generated)";
    }
  }

  if (mutation.match) {
    const matchValue = args[mutation.match];
    if (matchValue === undefined || matchValue === null || matchValue === "") {
      errors[mutation.match] = `identity field "${mutation.match}" is required for ${mutation.op}`;
    } else if (typeof matchValue !== "string" && typeof matchValue !== "number") {
      errors[mutation.match] = "identity field must be string or number";
    } else {
      value[mutation.match] = matchValue;
    }
    if (fields[mutation.match]) {
      errors[mutation.match] = "identity field must not be redeclared in fields";
    }
  }

  const known = new Set<string>([...Object.keys(fields), ...Object.keys(auto)]);
  if (mutation.match) known.add(mutation.match);
  for (const name of Object.keys(args)) {
    if (!known.has(name)) {
      errors[name] = `unknown field "${name}" (allowed: ${[...known].join(", ") || "none"})`;
    }
  }

  if (Object.keys(errors).length > 0) {
    const detail = Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join("; ");
    throw new DataValidationError(`mutation args validation failed (${mutation.op}): ${detail}`, errors);
  }
  return { value };
}

export interface ValidatedQueryParams {
  values: Record<string, string | number | boolean>;
  identityValue?: string | number;
}

export function validateQueryParams(
  query: ManifestQuery,
  params: Record<string, unknown>,
): ValidatedQueryParams {
  const errors: Record<string, string> = {};
  const values: Record<string, string | number | boolean> = {};
  let identityValue: string | number | undefined;

  const declared = query.params ?? {};
  const known = new Set<string>(Object.keys(declared));
  if (query.identity) known.add(query.identity);

  for (const [name, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null) continue;
    if (query.identity && name === query.identity) {
      if (typeof raw !== "string" && typeof raw !== "number") {
        errors[name] = "identity filter must be string or number";
      } else {
        identityValue = raw;
      }
      continue;
    }
    const rule: ManifestParam | undefined = declared[name];
    if (!rule) {
      errors[name] = `unknown param "${name}" (allowed: ${[...known].join(", ") || "none"})`;
      continue;
    }
    if (rule.type === "integer") {
      if (typeof raw !== "number" || !Number.isInteger(raw)) {
        errors[name] = "expected integer";
        continue;
      }
      values[name] = raw;
      continue;
    }
    if (rule.type === "boolean") {
      if (typeof raw !== "boolean") {
        errors[name] = "expected boolean";
        continue;
      }
      values[name] = raw;
      continue;
    }
    if (typeof raw !== "string") {
      errors[name] = "expected string";
      continue;
    }
    if (rule.type === "enum" && rule.values && !rule.values.includes(raw)) {
      errors[name] = `value must be one of: ${rule.values.join(", ")}`;
      continue;
    }
    values[name] = raw;
  }

  for (const [name, rule] of Object.entries(declared)) {
    if (rule.default === undefined || values[name] !== undefined) continue;
    if (rule.type === "integer" || rule.type === "boolean") continue;
    values[name] = rule.default;
  }

  if (Object.keys(errors).length > 0) {
    const detail = Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join("; ");
    throw new DataValidationError(`query params validation failed: ${detail}`, errors);
  }
  return { values, identityValue };
}
