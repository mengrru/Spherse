import { Type, type TSchema, type TLiteralValue } from "@sinclair/typebox";

function asUnionMembers(members: TSchema[]): [TSchema, ...TSchema[]] {
  return members as unknown as [TSchema, ...TSchema[]];
}

interface JsonSchema {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  items?: JsonSchema | JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  default?: unknown;
}

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null;
}

const TYPEBOX_PRIMITIVES: Record<string, TSchema> = {
  string: Type.String(),
  number: Type.Number(),
  integer: Type.Integer(),
  boolean: Type.Boolean(),
  null: Type.Null(),
};

function pickFirstType(schema: JsonSchema): string | undefined {
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.type)) {
    const nonNull = schema.type.find((t) => t !== "null");
    return nonNull;
  }
  return undefined;
}

function convertObject(schema: JsonSchema): TSchema {
  const props = schema.properties ?? {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const properties: Record<string, TSchema> = {};
  for (const [key, sub] of Object.entries(props)) {
    if (!isSchema(sub)) continue;
    const converted = jsonSchemaToTypebox(sub);
    properties[key] = required.has(key) ? converted : Type.Optional(converted);
  }
  if (schema.additionalProperties === true) {
    return Type.Object(properties, { additionalProperties: true });
  }
  return Type.Object(properties, { additionalProperties: false });
}

function convertArray(schema: JsonSchema): TSchema {
  if (Array.isArray(schema.items)) {
    const converted = schema.items.map((i) => (isSchema(i) ? jsonSchemaToTypebox(i) : Type.Unknown()));
    return Type.Tuple(converted as [TSchema, ...TSchema[]]);
  }
  if (isSchema(schema.items)) {
    return Type.Array(jsonSchemaToTypebox(schema.items));
  }
  return Type.Array(Type.Unknown());
}

export function jsonSchemaToTypebox(schema: unknown): TSchema {
  if (!isSchema(schema)) return Type.Unknown();

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const members = schema.enum
      .filter((v): v is TLiteralValue => typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null)
      .map((v) => Type.Literal(v));
    if (members.length) return Type.Union(asUnionMembers(members));
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const members = schema.anyOf.filter(isSchema).map((s) => jsonSchemaToTypebox(s));
    if (members.length) return Type.Union(asUnionMembers(members));
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const members = schema.oneOf.filter(isSchema).map((s) => jsonSchemaToTypebox(s));
    if (members.length) return Type.Union(asUnionMembers(members));
  }

  const firstType = pickFirstType(schema);

  switch (firstType) {
    case "string":
    case "number":
    case "integer":
    case "boolean":
    case "null":
      return TYPEBOX_PRIMITIVES[firstType];
    case "array":
      return convertArray(schema);
    case "object":
      return convertObject(schema);
    default:
      if (schema.properties || firstType === undefined) {
        const props = schema.properties;
        if (props) return convertObject(schema);
      }
      return Type.Unknown();
  }
}
