import fs from "node:fs/promises";
import path from "node:path";
import { humanize, inferField, TEXT_KEYS, TEXT_MAX } from "../shared/infer.js";
import { importFromAstro } from "./astro-deps.js";
import { parseDocument } from "./content.js";

// The inference rules live in `shared/infer.js` so the toolbar applies the same ones.
export { humanize, inferField };

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
  if (shape.integer) field.integer = true;
  return field;
}

/**
 * Map a JSON Schema node to a field type (plus what the type carries).
 *
 * @param {any} doc
 * @param {any} node
 * @param {string} key
 * @returns {{ type: FieldType, nullable?: boolean, options?: string[], item?: FieldDef, fields?: FieldDef[], min?: number, max?: number, integer?: boolean }}
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
    case "integer": {
      // z.number().int() → `type: "integer"`; some emitters write `multipleOf: 1` instead.
      const integer = type === "integer" || node.multipleOf === 1;
      return { type: "number", nullable, min: numberOr(node.minimum, node.exclusiveMinimum), max: numberOr(node.maximum, node.exclusiveMaximum), integer };
    }
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
  const loaded = await loadZodSchema(ctx, collectionName);
  if (!loaded.loaded) return null;
  const hints = new Map();
  if (loaded.schema) walkZod(loaded.schema, "", hints);
  return hints;
}

/**
 * The collection's Zod schema object, from `content.config.ts` loaded through
 * Vite. Shared by the hint probe above and by save-time validation
 * (`validate.js`): a function schema is called once with a stand-in `image()`
 * (a real `z.string()` from the project's astro, so `safeParse` runs on it).
 *
 * - `loaded: false` — no config file, or Vite couldn't load it (warned once).
 * - `hasSchema: false` — the collection defines no `schema:`.
 * - `strict` — the top-level object was declared `.strict()`.
 *
 * Results are memoised per loaded module, so a config change (Vite gives a
 * new module object) invalidates them.
 *
 * @param {SchemaCtx} ctx
 * @param {string} collectionName
 * @returns {Promise<{ loaded: boolean, hasSchema: boolean, schema: any | null, strict: boolean }>}
 */
export async function loadZodSchema(ctx, collectionName) {
  const none = { loaded: false, hasSchema: false, schema: null, strict: false };
  const server = ctx.server;
  if (!server) return none;
  const configFile = await findConfigFile(ctx.root);
  if (!configFile) return none;
  let mod;
  try {
    mod = await loadServerModule(server, "/" + path.relative(ctx.root, configFile).split(path.sep).join("/"));
  } catch (err) {
    warnOnce(ctx, `couldn't load ${path.basename(configFile)} (${err?.message ?? err}); saves aren't validated and image()/reference() are found by scanning the source`);
    return none;
  }
  let perModule = schemaCache.get(mod);
  if (!perModule) {
    perModule = new Map();
    schemaCache.set(mod, perModule);
  }
  if (perModule.has(collectionName)) return perModule.get(collectionName);

  const config = mod?.collections?.[collectionName];
  let result;
  if (!config || typeof config !== "object" || config.schema == null) {
    result = { loaded: true, hasSchema: false, schema: null, strict: false };
  } else {
    let schema = config.schema;
    try {
      if (typeof schema === "function") schema = schema({ image: await imageStubFactory(ctx) });
    } catch (err) {
      ctx.logger?.warn(`${collectionName}: schema() threw (${err?.message ?? err})`);
      schema = null;
    }
    const object = schema && typeof schema === "object" ? unwrapZod(schema) : null;
    result = {
      loaded: true,
      hasSchema: true,
      schema: schema && typeof schema === "object" ? schema : null,
      strict: isStrictObject(object),
    };
  }
  perModule.set(collectionName, result);
  return result;
}

/**
 * Import a project module through the dev server the way Astro does on that
 * version: the SSR environment's module runner (Astro 6+ / Vite 6+), else
 * `ssrLoadModule` (Astro 5 / Vite 5, and still present in later Vites).
 *
 * @param {any} server
 * @param {string} url
 */
function loadServerModule(server, url) {
  const runner = server.environments?.ssr?.runner;
  if (runner && typeof runner.import === "function") return runner.import(url);
  if (typeof server.ssrLoadModule === "function") return server.ssrLoadModule(url);
  return Promise.reject(new Error("this Vite server has neither an SSR module runner nor ssrLoadModule"));
}

/** `.strict()` on the top-level object: zod 3 marks `unknownKeys`, zod 4 sets the catchall to `never`. */
function isStrictObject(object) {
  const node = zodNode(object);
  if (!node) return false;
  if (node.v4) return node.type === "object" && zodNode(node.def.catchall)?.type === "never";
  return node.type === "ZodObject" && node.def.unknownKeys === "strict";
}

/** @type {WeakMap<object, Map<string, any>>} */
const schemaCache = new WeakMap();
const warned = new WeakSet();
function warnOnce(ctx, message) {
  const key = ctx.server ?? ctx;
  if (warned.has(key)) return;
  warned.add(key);
  ctx.logger?.warn(message);
}

/**
 * A stand-in for `image()`: a real `z.string()` (from the project's astro) that
 * rejects an empty path, carrying a marker the hint walker recognises. Astro's
 * own `image()` also resolves the file; `validate.js` does that part with the
 * entry's directory in hand. Without `astro/zod` at hand the stub is a
 * Zod-shaped object that only serves the walker.
 */
async function imageStubFactory(ctx) {
  let z = null;
  try {
    z = (await importFromAstro(ctx.root, "astro/zod")).z;
  } catch {
    /* astro/zod not resolvable: hints only */
  }
  return () => {
    if (z) {
      const s = z.string().min(1, "Image path can't be empty");
      s._floatImage = true;
      return s;
    }
    const marker = { _floatImage: true, _def: { typeName: "ZodString" } };
    return chainable(marker, marker);
  };
}

function chainable(node, marker) {
  const wrap = () => chainable({ _def: { typeName: "ZodOptional", innerType: node } }, marker);
  for (const method of ["optional", "nullable", "nullish", "default", "describe", "refine", "superRefine", "transform", "catch", "brand", "readonly", "pipe", "or", "and", "array"]) {
    node[method] = method === "array" ? () => chainable({ _def: { typeName: "ZodArray", type: node } }, marker) : wrap;
  }
  return node;
}

/** Field paths that hold an `image()` in this collection's schema (top level and nested, `[]` for array items). */
export async function imageFieldPaths(ctx, collectionName) {
  const hints = await collectHints(ctx, collectionName);
  return Array.from(hints).filter(([, h]) => h.image).map(([p]) => p);
}

/**
 * One view over the two Zod generations Astro ships: zod 3 (Astro 5) keeps
 * `_def.typeName` ("ZodOptional", …); zod 4 (Astro 6+) keeps `_zod.def.type`
 * ("optional", …) with different child keys. Float's own `imageStub()` nodes
 * use the zod 3 shape. Returns null for anything that isn't a Zod schema.
 *
 * @param {any} schema
 * @returns {{ type: string, def: any, v4: boolean } | null}
 */
function zodNode(schema) {
  if (!schema || typeof schema !== "object") return null;
  const d4 = schema._zod?.def;
  if (d4 && typeof d4.type === "string") return { type: d4.type, def: d4, v4: true };
  const d3 = schema._def;
  if (d3 && typeof d3.typeName === "string") return { type: d3.typeName, def: d3, v4: false };
  return null;
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
  const node = zodNode(inner);
  if (!node) return;
  if (node.type === "ZodObject" || node.type === "object") {
    const shape = typeof node.def.shape === "function" ? node.def.shape() : node.def.shape;
    for (const [key, child] of Object.entries(shape ?? {})) walkZod(child, prefix ? `${prefix}.${key}` : key, hints, depth + 1);
    return;
  }
  if (node.type === "ZodArray" || node.type === "array") {
    walkZod(node.v4 ? node.def.element : node.def.type, `${prefix}[]`, hints, depth + 1);
    return;
  }
  if (isReferenceTransform(node)) {
    const target = probeReference(inner);
    if (target && prefix) hints.set(prefix, { reference: target });
  }
}

/** Astro's `reference()`: a transform over a union — zod 3 `ZodEffects`, zod 4 a `pipe` into a `transform`. */
function isReferenceTransform(node) {
  if (node.v4) {
    return node.type === "pipe" && zodNode(node.def.in)?.type === "union" && zodNode(node.def.out)?.type === "transform";
  }
  return node.type === "ZodEffects" && node.def.effect?.type === "transform" && zodNode(node.def.schema)?.type === "ZodUnion";
}

/**
 * Peel `.optional()`, `.nullable()`, `.default()`, `.catch()`, `.brand()`, `.pipe()`
 * and refinements — but stop at a transform, since that's what `reference()` is.
 */
function unwrapZod(schema, depth = 0) {
  if (!schema || typeof schema !== "object" || depth > 12) return schema;
  if (schema._floatImage) return schema;
  const node = zodNode(schema);
  if (!node) return schema;
  const { type, def } = node;
  if (node.v4) {
    switch (type) {
      case "optional":
      case "nullable":
      case "default":
      case "prefault":
      case "catch":
      case "readonly":
      case "nonoptional":
        return unwrapZod(def.innerType, depth + 1);
      case "lazy":
        return typeof def.getter === "function" ? unwrapZod(def.getter(), depth + 1) : schema;
      case "pipe":
        // `.transform()` is a pipe into a transform: stop there (that's what reference() is).
        if (zodNode(def.out)?.type === "transform") return schema;
        return unwrapZod(def.in, depth + 1);
      default:
        return schema;
    }
  }
  switch (type) {
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodCatch":
    case "ZodBranded":
    case "ZodReadonly":
      return unwrapZod(def.innerType, depth + 1);
    case "ZodLazy":
      return typeof def.getter === "function" ? unwrapZod(def.getter(), depth + 1) : schema;
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

function isEmpty(value) {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

// ---- helpers ---------------------------------------------------------------------------

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
      case "number": {
        const min = typeof field.min === "number" ? field.min : 0;
        template[field.key] = field.integer ? Math.ceil(min) : min;
        break;
      }
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
      case "json":
        template[field.key] = null;
        break;
      default:
        // string, text: an empty string is valid. image, reference: nothing
        // valid can be invented here; `createEntry` fills references from the
        // target collection and leaves a required image for the author.
        template[field.key] = "";
    }
  }
  return template;
}
