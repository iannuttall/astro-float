import fs from "node:fs/promises";
import path from "node:path";

/**
 * The collection's Zod schema, as Astro already describes it.
 *
 * `astro sync` (which `astro dev` runs at start-up and again whenever
 * `content.config.ts` changes) writes a JSON Schema for every collection to
 * `.astro/collections/<name>.schema.json`. Reading that file — rather than
 * parsing `z.object({ … })` out of the config by hand — means `.optional()`,
 * `.default()`, `z.enum()`, `.describe()`, `z.coerce.date()` and friends are
 * all understood exactly the way Astro understands them.
 *
 * The file is read fresh on every request (it's tiny) so a config edit shows
 * up on the next load. When it doesn't exist the sidebar falls back to
 * inferring controls from the frontmatter values, as it always has.
 *
 * @typedef {"string" | "text" | "number" | "boolean" | "date" | "tags" | "enum" | "reference" | "json"} SchemaKind
 * @typedef {{
 *   key: string,
 *   kind: SchemaKind,
 *   required: boolean,
 *   nullable?: boolean,
 *   default?: unknown,
 *   values?: Array<string | number>,
 *   description?: string,
 *   items?: "string" | "number",
 *   collection?: string,
 *   integer?: boolean,
 *   min?: number,
 *   max?: number,
 * }} SchemaField
 * @typedef {{ file: string, fields: SchemaField[], strict: boolean }} CollectionSchema
 */

/** Keys Astro adds to the JSON Schema for editor tooling; not frontmatter. */
const SYNTHETIC_KEYS = new Set(["$schema"]);

/** Where Astro looks for the content config, in order. */
export const CONFIG_CANDIDATES = [
  "src/content.config.ts",
  "src/content.config.mts",
  "src/content.config.js",
  "src/content.config.mjs",
  "src/content/config.ts",
  "src/content/config.js",
];

/**
 * @param {{ root: string }} ctx
 * @param {string} collectionName
 * @returns {Promise<CollectionSchema | null>}
 */
export async function readCollectionSchema(ctx, collectionName) {
  if (!/^[\w.-]+$/.test(collectionName)) return null;
  const file = path.join(ctx.root, ".astro", "collections", `${collectionName}.schema.json`);
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = schemaFromJson(doc);
  if (!parsed) return null;
  // `reference("blog")` reaches the JSON Schema as "a string or an { id, collection } object" — the
  // collection name doesn't survive. The one thing we do read out of content.config.ts is that name.
  if (parsed.fields.some((f) => f.kind === "reference")) {
    const config = await readContentConfig(ctx.root);
    for (const field of parsed.fields) {
      if (field.kind !== "reference") continue;
      const target = config && referenceTarget(config, field.key);
      if (target) field.collection = target;
    }
  }
  return { file: path.relative(ctx.root, file).split(path.sep).join("/"), ...parsed };
}

async function readContentConfig(root) {
  for (const candidate of CONFIG_CANDIDATES) {
    try {
      return await fs.readFile(path.join(root, candidate), "utf8");
    } catch {
      /* next */
    }
  }
  return null;
}

/** `about: reference("blog")` → "blog". Exported for tests. */
export function referenceTarget(configText, key) {
  const re = new RegExp(`(?:^|[\\s{,])${escapeRegExp(key)}\\s*:\\s*reference\\(\\s*["'\`]([^"'\`]+)["'\`]\\s*\\)`);
  const m = configText.match(re);
  return m ? m[1] : null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Turn Astro's JSON Schema document into a flat, ordered field list.
 * Exported for tests; `readCollectionSchema` is the entry point.
 *
 * @param {any} doc
 * @returns {{ fields: SchemaField[], strict: boolean } | null}
 */
export function schemaFromJson(doc) {
  if (!doc || typeof doc !== "object") return null;
  const root = resolveRef(doc, doc);
  if (!root || root.type !== "object" || !root.properties || typeof root.properties !== "object") return null;

  const required = new Set(Array.isArray(root.required) ? root.required : []);
  /** @type {SchemaField[]} */
  const fields = [];
  for (const [key, node] of Object.entries(root.properties)) {
    if (SYNTHETIC_KEYS.has(key)) continue;
    const field = describeField(doc, key, node, required.has(key));
    if (field) fields.push(field);
  }
  return { fields, strict: root.additionalProperties === false };
}

/**
 * @param {any} doc
 * @param {string} key
 * @param {any} node
 * @param {boolean} required
 * @returns {SchemaField | null}
 */
function describeField(doc, key, node, required) {
  const resolved = resolveRef(doc, node);
  if (!resolved || typeof resolved !== "object") return null;

  const { kind, nullable, values, items, integer, min, max } = kindOf(doc, resolved);
  /** @type {SchemaField} */
  const field = { key, kind, required };
  if (nullable) field.nullable = true;
  if ("default" in resolved) field.default = resolved.default;
  if (values) field.values = values;
  if (items) field.items = items;
  if (integer) field.integer = true;
  if (typeof min === "number") field.min = min;
  if (typeof max === "number") field.max = max;
  if (typeof resolved.description === "string" && resolved.description.trim()) field.description = resolved.description.trim();
  return field;
}

/**
 * Map a JSON Schema node to the control the sidebar should draw.
 *
 * @param {any} doc
 * @param {any} node
 * @returns {{ kind: SchemaKind, nullable?: boolean, values?: Array<string | number>, items?: "string" | "number", integer?: boolean, min?: number, max?: number }}
 */
function kindOf(doc, node) {
  node = resolveRef(doc, node) ?? node;
  if (!node || typeof node !== "object") return { kind: "json" };

  // `.nullable()` / unions: strip `null`, then describe what's left.
  const branches = Array.isArray(node.anyOf) ? node.anyOf : Array.isArray(node.oneOf) ? node.oneOf : null;
  if (branches) {
    const real = branches.map((b) => resolveRef(doc, b) ?? b).filter((b) => b && !(b.type === "null"));
    const nullable = real.length !== branches.length;
    if (!real.length) return { kind: "json", nullable };
    // z.coerce.date() / z.date(): Astro emits { date-time | date | unix-time }.
    if (real.some((b) => b.type === "string" && (b.format === "date-time" || b.format === "date"))) return { kind: "date", nullable };
    // reference("blog"): a string id, or { id | slug, collection }.
    if (isReferenceShape(real)) return { kind: "reference", nullable };
    if (real.length === 1) return { ...kindOf(doc, real[0]), nullable };
    // A union of literals is an enum.
    const literals = real.every((b) => Array.isArray(b.enum) || "const" in b);
    if (literals) {
      const values = real.flatMap((b) => (Array.isArray(b.enum) ? b.enum : [b.const])).filter((v) => typeof v === "string" || typeof v === "number");
      if (values.length) return { kind: "enum", values, nullable };
    }
    return { kind: "json", nullable };
  }

  if (Array.isArray(node.enum)) {
    const values = node.enum.filter((v) => typeof v === "string" || typeof v === "number");
    if (values.length) return { kind: "enum", values };
  }
  if ("const" in node && (typeof node.const === "string" || typeof node.const === "number")) return { kind: "enum", values: [node.const] };

  const type = Array.isArray(node.type) ? node.type.find((t) => t !== "null") : node.type;
  const nullable = Array.isArray(node.type) && node.type.includes("null") ? true : undefined;
  switch (type) {
    case "string":
      if (node.format === "date-time" || node.format === "date") return { kind: "date", nullable };
      if (typeof node.maxLength === "number" && node.maxLength > 80) return { kind: "text", nullable };
      if (typeof node.minLength === "number" && node.minLength > 80) return { kind: "text", nullable };
      return { kind: "string", nullable };
    case "number":
    case "integer":
      return { kind: "number", nullable, integer: type === "integer", min: node.minimum, max: node.maximum };
    case "boolean":
      return { kind: "boolean", nullable };
    case "array": {
      const item = kindOf(doc, node.items);
      if (item.kind === "string" || item.kind === "enum") return { kind: "tags", items: "string", nullable };
      if (item.kind === "number") return { kind: "tags", items: "number", nullable };
      return { kind: "json", nullable };
    }
    case "object":
      return { kind: "json", nullable };
    default:
      return { kind: "json", nullable };
  }
}

/** Astro's `reference()`: `anyOf [ string, { id, collection }, { slug, collection } ]`. */
function isReferenceShape(branches) {
  if (!branches.some((b) => b.type === "string" && !b.format && !b.enum)) return false;
  const objects = branches.filter((b) => b.type === "object");
  if (!objects.length) return false;
  return objects.every((b) => {
    const props = b.properties && typeof b.properties === "object" ? Object.keys(b.properties) : [];
    return props.includes("collection") && (props.includes("id") || props.includes("slug"));
  });
}

/** Follow a local `$ref` (`#/definitions/blog`). Returns the node itself when it isn't a ref. */
function resolveRef(doc, node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 8) return node;
  if (typeof node.$ref !== "string" || !node.$ref.startsWith("#/")) return node;
  let target = doc;
  for (const seg of node.$ref.slice(2).split("/")) {
    if (!target || typeof target !== "object") return null;
    target = target[seg.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return resolveRef(doc, target, depth + 1);
}

/**
 * A frontmatter skeleton for a new entry, from the schema alone: fields with a
 * default get it, required fields get an empty value of the right shape, and
 * optional fields without a default are left out (Astro treats them as absent).
 *
 * @param {CollectionSchema | null} schema
 * @returns {Record<string, unknown>}
 */
export function templateFromSchema(schema) {
  /** @type {Record<string, unknown>} */
  const template = {};
  if (!schema) return template;
  const today = new Date().toISOString().slice(0, 10);
  for (const field of schema.fields) {
    if ("default" in field) {
      template[field.key] = field.default;
      continue;
    }
    if (!field.required) continue;
    switch (field.kind) {
      case "boolean":
        template[field.key] = false;
        break;
      case "number":
        template[field.key] = 0;
        break;
      case "date":
        template[field.key] = today;
        break;
      case "tags":
        template[field.key] = [];
        break;
      case "enum":
        template[field.key] = field.values?.[0] ?? "";
        break;
      case "reference":
        template[field.key] = "";
        break;
      case "json":
        template[field.key] = {};
        break;
      default:
        template[field.key] = "";
    }
  }
  return template;
}
