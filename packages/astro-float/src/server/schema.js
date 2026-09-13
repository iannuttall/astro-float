import fs from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "./content.js";

/**
 * The collection's schema, in the shape the toolbar consumes
 * (`toolbar/schema.ts`: `CollectionSchema` → `FieldDef[]`).
 *
 * Two sources, tried in order:
 *
 * 1. **zod** — `astro sync` (run by `astro dev` at start-up and on every
 *    `content.config.ts` change) writes a JSON Schema per collection to
 *    `.astro/collections/<name>.schema.json`. That file already encodes
 *    `.optional()`, `.default()`, `z.enum()`, `.describe()`, `.min()`,
 *    `z.coerce.date()` and friends exactly the way Astro understands them,
 *    so it's the primary source. Two helpers don't survive the trip:
 *    `image()` becomes a plain string and `reference("blog")` a string-or-
 *    object union with the collection name gone. For those the config
 *    itself is loaded through Vite (`ssrLoadModule`, the same way Astro
 *    loads it) and the Zod shapes are probed — see `probeConfig`. If the
 *    module can't be loaded, a conservative source scan of the config file
 *    fills the same gap.
 *
 * 2. **inferred** — no JSON Schema (no `schema:` in the config, or no sync
 *    yet): types are guessed from the frontmatter values of the
 *    collection's entries, as the sidebar always did.
 *
 * @typedef {import('../toolbar/schema.ts').FieldType} FieldType
 * @typedef {import('../toolbar/schema.ts').FieldDef} FieldDef
 * @typedef {import('../toolbar/schema.ts').CollectionSchema} CollectionSchema
 *
 * @typedef {{ root: string, server?: import('vite').ViteDevServer, logger?: { warn(msg: string): void } }} SchemaCtx
 */

/** Keys Astro adds to the JSON Schema for editor tooling; not frontmatter. */
const SYNTHETIC_KEYS = new Set(["$schema"]);
/** Keys that read as long text even when the schema just says `z.string()`. */
const TEXT_KEYS = new Set(["description", "summary", "excerpt"]);
const TEXT_MAX = 160;

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
 * @param {SchemaCtx} ctx
 * @param {{ name: string, entries: Array<{ file: string }> }} collection
 * @returns {Promise<CollectionSchema>}
 */
export async function readCollectionSchema(ctx, collection) {
  const fromZod = await readJsonSchema(ctx, collection.name);
  if (fromZod) {
    const hints = await collectHints(ctx, collection.name);
    if (hints.size) applyHints(fromZod, hints, "");
    return { collection: collection.name, source: "zod", fields: fromZod };
  }
  return { collection: collection.name, source: "inferred", fields: await inferFields(ctx, collection) };
}

// ---- 1. Astro's JSON Schema ----------------------------------------------------------

/**
 * @param {SchemaCtx} ctx
 * @param {string} collectionName
 * @returns {Promise<FieldDef[] | null>}
 */
async function readJsonSchema(ctx, collectionName) {
  if (!/^[\w.-]+$/.test(collectionName)) return null;
  const file = path.join(ctx.root, ".astro", "collections", `${collectionName}.schema.json`);
  let doc;
  try {
    doc = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
  return fieldsFromJsonSchema(doc);
}

/**
 * Turn Astro's JSON Schema document into an ordered field list.
 * Exported for tests; `readCollectionSchema` is the entry point.
 *
 * @param {any} doc
 * @returns {FieldDef[] | null}
 */
export function fieldsFromJsonSchema(doc) {
  if (!doc || typeof doc !== "object") return null;
  const root = resolveRef(doc, doc);
  if (!root || root.type !== "object" || !root.properties || typeof root.properties !== "object") return null;
  return objectFields(doc, root, true);
}

/** @returns {FieldDef[]} */
function objectFields(doc, node, top = false) {
  const required = new Set(Array.isArray(node.required) ? node.required : []);
  const fields = [];
  for (const [key, prop] of Object.entries(node.properties ?? {})) {
    if (top && SYNTHETIC_KEYS.has(key)) continue;
    const field = fieldFromNode(doc, key, prop, required.has(key));
    if (field) fields.push(field);
  }
  return fields;
}

/**
 * @param {any} doc
 * @param {string} key
 * @param {any} node
 * @param {boolean} listedRequired
 * @returns {FieldDef | null}
 */
function fieldFromNode(doc, key, node, listedRequired) {
  const resolved = resolveRef(doc, node);
  if (!resolved || typeof resolved !== "object") return null;
  const shape = shapeOf(doc, resolved, key);
  /** @type {FieldDef} */
  const field = {
    key,
    label: humanize(key),
    type: shape.type,
    // "required" in the contract's sense: not optional, no default, not nullable.
    required: listedRequired && !shape.nullable && !("default" in resolved),
  };
  if (typeof resolved.description === "string" && resolved.description.trim()) field.description = resolved.description.trim();
  if ("default" in resolved) field.default = resolved.default;
  if (shape.options) field.options = shape.options;
  if (shape.item) field.item = shape.item;
  if (shape.fields) field.fields = shape.fields;
  if (typeof shape.min === "number") field.min = shape.min;
  if (typeof shape.max === "number") field.max = shape.max;
  return field;
}

/**
 * Map a JSON Schema node to a field type (plus what the type carries).
 *
 * @param {any} doc
 * @param {any} node
 * @param {string} key
 * @returns {{ type: FieldType, nullable?: boolean, options?: string[], item?: FieldDef, fields?: FieldDef[], min?: number, max?: number }}
 */
function shapeOf(doc, node, key) {
  node = resolveRef(doc, node) ?? node;
  if (!node || typeof node !== "object") return { type: "json" };

  // `.nullable()` / unions: strip `null`, then describe what's left.
  const branches = Array.isArray(node.anyOf) ? node.anyOf : Array.isArray(node.oneOf) ? node.oneOf : null;
  if (branches) {
    const real = branches.map((b) => resolveRef(doc, b) ?? b).filter((b) => b && b.type !== "null");
    const nullable = real.length !== branches.length;
    if (!real.length) return { type: "json", nullable };
    // z.coerce.date() / z.date(): Astro emits { date-time | date | unix-time }. A
    // schema that only allows date-time is a datetime; the coerce union takes either.
    const formats = new Set(real.filter((b) => b.type === "string").map((b) => b.format));
    if (formats.has("date-time") && !formats.has("date")) return { type: "datetime", nullable };
    if (formats.has("date")) return { type: "date", nullable };
    // reference("blog"): a string id, or { id | slug, collection }. The collection name is filled in by `collectHints`.
    if (isReferenceShape(real)) return { type: "reference", nullable };
    if (real.length === 1) return { ...shapeOf(doc, real[0], key), nullable };
    // A union of string literals is an enum.
    if (real.every((b) => Array.isArray(b.enum) || "const" in b)) {
      const values = real.flatMap((b) => (Array.isArray(b.enum) ? b.enum : [b.const]));
      if (values.every((v) => typeof v === "string")) return { type: "enum", options: values, nullable };
    }
    return { type: "json", nullable };
  }

  if (Array.isArray(node.enum)) {
    if (node.enum.every((v) => typeof v === "string")) return { type: "enum", options: node.enum };
    return { type: "json" };
  }
  if ("const" in node) return typeof node.const === "string" ? { type: "enum", options: [node.const] } : { type: "json" };

  const type = Array.isArray(node.type) ? node.type.find((t) => t !== "null") : node.type;
  const nullable = Array.isArray(node.type) && node.type.includes("null") ? true : undefined;
  switch (type) {
    case "string": {
      if (node.format === "date-time") return { type: "datetime", nullable };
      if (node.format === "date") return { type: "date", nullable };
      const min = typeof node.minLength === "number" ? node.minLength : undefined;
      const max = typeof node.maxLength === "number" ? node.maxLength : undefined;
      const long = (typeof max === "number" && max > TEXT_MAX) || TEXT_KEYS.has(key.toLowerCase());
      return { type: long ? "text" : "string", nullable, min, max };
    }
    case "number":
    case "integer":
      return { type: "number", nullable, min: numberOr(node.minimum, node.exclusiveMinimum), max: numberOr(node.maximum, node.exclusiveMaximum) };
    case "boolean":
      return { type: "boolean", nullable };
    case "array": {
      const itemNode = resolveRef(doc, node.items);
      const item = itemNode && typeof itemNode === "object" ? shapeOf(doc, itemNode, key) : { type: "json" };
      if (item.type === "string" || item.type === "text" || item.type === "enum") return { type: "tags", nullable };
      return { type: "array", nullable, item: fieldFromNode(doc, "item", itemNode ?? {}, true) ?? { key: "item", label: "Item", type: "json", required: true } };
    }
    case "object":
      if (node.properties && typeof node.properties === "object") return { type: "object", nullable, fields: objectFields(doc, node) };
      return { type: "json", nullable };
    default:
      return { type: "json", nullable };
  }
}

function numberOr(a, b) {
  return typeof a === "number" ? a : typeof b === "number" ? b : undefined;
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

// ---- 1b. image() / reference() hints from the config itself ---------------------------

/**
 * Hints keyed by field path ("cover", "hero.src", "gallery[]"): `{ image: true }`
 * or `{ reference: "<collection>" }`. From the loaded Zod schema when Vite can
 * give us the module; from a source scan otherwise.
 *
 * @returns {Promise<Map<string, { image?: true, reference?: string }>>}
 */
async function collectHints(ctx, collectionName) {
  const fromModule = await probeConfig(ctx, collectionName);
  if (fromModule) return fromModule;
  return scanConfigSource(ctx);
}

/**
 * Load `content.config.ts` through Vite (as Astro does) and walk the Zod
 * shapes. A function schema is called with a stub `image()` whose result is
 * marked; `reference()` is Astro's real one — running its transform on a probe
 * string yields `{ id, collection }` (or an issue naming the collection), which
 * is the only place the target survives.
 *
 * Returns null when the module can't be loaded, so the caller can fall back.
 */
async function probeConfig(ctx, collectionName) {
  const server = ctx.server;
  if (!server) return null;
  const configFile = await findConfigFile(ctx.root);
  if (!configFile) return null;
  let mod;
  try {
    mod = await server.ssrLoadModule("/" + path.relative(ctx.root, configFile).split(path.sep).join("/"));
  } catch (err) {
    ctx.logger?.warn(`couldn't load ${path.basename(configFile)} to look for image()/reference() (${err?.message ?? err}); scanning the source instead`);
    return null;
  }
  const config = mod?.collections?.[collectionName];
  if (!config || typeof config !== "object") return new Map();
  let schema = config.schema;
  try {
    if (typeof schema === "function") schema = schema({ image: () => imageStub() });
  } catch (err) {
    ctx.logger?.warn(`${collectionName}: schema() threw while probing for image()/reference() (${err?.message ?? err})`);
    return null;
  }
  const hints = new Map();
  if (schema && typeof schema === "object") walkZod(schema, "", hints);
  return hints;
}

/**
 * A stand-in for `image()`: a Zod-shaped object that answers every chaining
 * call (`.optional()`, `.describe()`, `.refine()`, …) with a wrapper the walker
 * can peel, and carries a marker at the bottom.
 */
function imageStub() {
  const marker = { _floatImage: true, _def: { typeName: "ZodString" } };
  return chainable(marker, marker);
}

function chainable(node, marker) {
  const wrap = () => chainable({ _def: { typeName: "ZodOptional", innerType: node } }, marker);
  for (const method of ["optional", "nullable", "nullish", "default", "describe", "refine", "superRefine", "transform", "catch", "brand", "readonly", "pipe", "or", "and", "array"]) {
    node[method] = method === "array" ? () => chainable({ _def: { typeName: "ZodArray", type: node } }, marker) : wrap;
  }
  return node;
}

/** Walk a Zod schema, recording image and reference fields by path. */
function walkZod(schema, prefix, hints, depth = 0) {
  if (!schema || typeof schema !== "object" || depth > 6) return;
  const inner = unwrapZod(schema);
  if (!inner) return;
  if (inner._floatImage) {
    if (prefix) hints.set(prefix, { image: true });
    return;
  }
  const typeName = inner._def?.typeName;
  if (typeName === "ZodObject") {
    const shape = typeof inner._def.shape === "function" ? inner._def.shape() : inner._def.shape;
    for (const [key, child] of Object.entries(shape ?? {})) walkZod(child, prefix ? `${prefix}.${key}` : key, hints, depth + 1);
    return;
  }
  if (typeName === "ZodArray") {
    walkZod(inner._def.type, `${prefix}[]`, hints, depth + 1);
    return;
  }
  if (typeName === "ZodEffects" && inner._def.effect?.type === "transform" && inner._def.schema?._def?.typeName === "ZodUnion") {
    const target = probeReference(inner);
    if (target && prefix) hints.set(prefix, { reference: target });
  }
}

/**
 * Peel `.optional()`, `.nullable()`, `.default()`, `.catch()`, `.brand()`, `.pipe()`
 * and refinements — but stop at a transform, since that's what `reference()` is.
 */
function unwrapZod(schema, depth = 0) {
  if (!schema || typeof schema !== "object" || depth > 12) return schema;
  if (schema._floatImage) return schema;
  const def = schema._def;
  if (!def) return schema;
  switch (def.typeName) {
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodCatch":
    case "ZodBranded":
    case "ZodReadonly":
      return unwrapZod(def.innerType, depth + 1);
    case "ZodPipeline":
      return unwrapZod(def.in, depth + 1);
    case "ZodEffects":
      if (def.effect?.type === "transform") return schema;
      return unwrapZod(def.schema, depth + 1);
    default:
      return schema;
  }
}

/** Run Astro's reference transform on a probe id: it answers with the collection it points at. */
function probeReference(effects) {
  try {
    const result = effects.safeParse("__astro_float_probe__");
    if (result.success && result.data && typeof result.data === "object" && typeof result.data.collection === "string") return result.data.collection;
    if (!result.success) {
      for (const issue of result.error?.issues ?? []) {
        const m = /Reference to (\S+) invalid/.exec(issue.message ?? "");
        if (m) return m[1];
      }
    }
  } catch {
    /* not a reference after all */
  }
  return null;
}

/**
 * Fallback without Vite: a conservative scan of the config source for
 * `key: image()` and `key: reference("name")`. Top-level keys only, and only
 * when written literally — that covers how nearly every project writes them.
 */
async function scanConfigSource(ctx) {
  const hints = new Map();
  const file = await findConfigFile(ctx.root);
  if (!file) return hints;
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return hints;
  }
  for (const m of text.matchAll(/(?:^|[\s{,])([A-Za-z_$][\w$]*)\s*:\s*image\(\s*\)/g)) hints.set(m[1], { image: true });
  for (const m of text.matchAll(/(?:^|[\s{,])([A-Za-z_$][\w$]*)\s*:\s*reference\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) hints.set(m[1], { reference: m[2] });
  return hints;
}

/** Overlay hints onto the JSON-derived fields (recursing into objects and array items). */
function applyHints(fields, hints, prefix) {
  for (const field of fields) {
    const p = prefix ? `${prefix}.${field.key}` : field.key;
    applyHint(field, hints.get(p));
    if (field.fields) applyHints(field.fields, hints, p);
    if (field.item) {
      applyHint(field.item, hints.get(`${p}[]`));
      if (field.item.fields) applyHints(field.item.fields, hints, `${p}[]`);
    }
  }
}

function applyHint(field, hint) {
  if (!hint) return;
  if (hint.image) {
    field.type = "image";
    delete field.min;
    delete field.max;
  } else if (hint.reference) {
    field.type = "reference";
    field.collection = hint.reference;
  }
}

async function findConfigFile(root) {
  for (const candidate of CONFIG_CANDIDATES) {
    const abs = path.join(root, candidate);
    try {
      await fs.access(abs);
      return abs;
    } catch {
      /* next */
    }
  }
  return null;
}

// ---- 2. Inference from values ----------------------------------------------------------

/**
 * No schema: guess a field list from the frontmatter of the collection's
 * entries (first appearance wins the order; the first non-empty value wins the
 * type). Nothing is marked required — it's a guess, not a rule.
 *
 * @returns {Promise<FieldDef[]>}
 */
async function inferFields(ctx, collection) {
  /** @type {Map<string, unknown>} */
  const samples = new Map();
  for (const e of (collection.entries ?? []).slice(0, 12)) {
    try {
      const { frontmatter } = parseDocument(await fs.readFile(path.resolve(ctx.root, e.file), "utf8"));
      for (const [key, value] of Object.entries(frontmatter)) {
        if (!samples.has(key) || isEmpty(samples.get(key))) samples.set(key, value);
      }
    } catch {
      /* skip unreadable */
    }
  }
  return Array.from(samples, ([key, value]) => inferField(key, value));
}

/** @returns {FieldDef} */
export function inferField(key, value) {
  const shape = inferShape(key, value);
  /** @type {FieldDef} */
  const field = { key, label: humanize(key), type: shape.type, required: false };
  if (shape.item) field.item = shape.item;
  if (shape.fields) field.fields = shape.fields;
  return field;
}

function inferShape(key, value) {
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "number") return { type: "number" };
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}[T ]\d/.test(value)) return { type: "datetime" };
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { type: "date" };
    if (value.length > TEXT_MAX || value.includes("\n") || TEXT_KEYS.has(key.toLowerCase())) return { type: "text" };
    return { type: "string" };
  }
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string")) return { type: "tags" };
    const first = value.find((v) => v != null);
    return { type: "array", item: first === undefined ? { key: "item", label: "Item", type: "json", required: false } : inferField("item", first) };
  }
  if (value && typeof value === "object") {
    return { type: "object", fields: Object.entries(value).map(([k, v]) => inferField(k, v)) };
  }
  return { type: "string" };
}

function isEmpty(value) {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

// ---- helpers ---------------------------------------------------------------------------

/** `pubDate` → "Pub date", `hero_image` → "Hero image", `SEOTitle` → "SEO title". */
export function humanize(key) {
  const words = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .split(/\s+/);
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : /^[A-Z0-9]+$/.test(w) ? w : w.toLowerCase())).join(" ");
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
  if (!schema || schema.source !== "zod") return template;
  const today = new Date().toISOString().slice(0, 10);
  for (const field of schema.fields) {
    if ("default" in field) {
      template[field.key] = field.default;
      continue;
    }
    if (!field.required) continue;
    switch (field.type) {
      case "boolean":
        template[field.key] = false;
        break;
      case "number":
        template[field.key] = typeof field.min === "number" ? field.min : 0;
        break;
      case "date":
        template[field.key] = today;
        break;
      case "datetime":
        template[field.key] = new Date().toISOString();
        break;
      case "tags":
      case "array":
        template[field.key] = [];
        break;
      case "enum":
        template[field.key] = field.options?.[0] ?? "";
        break;
      case "object":
        template[field.key] = {};
        break;
      default:
        // string, text, image, reference, json: nothing sensible to invent
        template[field.key] = "";
    }
  }
  return template;
}
