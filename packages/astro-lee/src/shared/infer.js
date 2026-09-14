/**
 * Field inference shared by the Node server (`server/schema.js`) and the
 * browser toolbar (`toolbar/schema.ts`). One set of rules, so a key gets the
 * same label and control whichever side answers: the server when it infers a
 * collection without a Zod schema, the client for keys the schema doesn't know.
 *
 * Plain JS with JSDoc types; `infer.d.ts` next to it carries the declarations.
 *
 * @typedef {import('../toolbar/schema.ts').FieldType} FieldType
 * @typedef {import('../toolbar/schema.ts').FieldDef} FieldDef
 */

/** Keys that read as long text even when the value (or schema) says "string". */
export const TEXT_KEYS = new Set(["description", "summary", "excerpt", "abstract", "intro", "lede"]);
/** A string longer than this is long text (the schema contract: `.max > 160`). */
export const TEXT_MAX = 160;
/** `2026-09-01`, `2026-09-01T10:00:00Z`, `2026-09-01 10:00` … */
export const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;
/** A date with a clock time. */
export const HAS_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
/** A value that names an image file. */
export const IMAGE_LIKE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
/** Keys that hold an image when their value is a non-empty string. */
export const IMAGE_KEYS = /^(image|cover|coverImage|heroImage|hero|thumbnail|thumb|ogImage|photo|banner)$/i;

/**
 * `pubDate` → "Pub date", `hero_image` → "Hero image", `SEOTitle` → "SEO title".
 * @param {string} key
 * @returns {string}
 */
export function humanize(key) {
  const words = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : /^[A-Z0-9]+$/.test(w) ? w : w.toLowerCase()))
    .join(" ");
}

/**
 * A definition for one key, from its value alone. Never marked required: it's
 * a guess, not a rule.
 *
 * @param {string} key
 * @param {unknown} value
 * @returns {FieldDef}
 */
export function inferField(key, value) {
  /** @type {FieldDef} */
  const def = { key, label: humanize(key), type: inferType(key, value), required: false };
  if (def.type === "object") {
    const obj = /** @type {Record<string, unknown>} */ (value && typeof value === "object" ? value : {});
    def.fields = Object.entries(obj).map(([k, v]) => inferField(k, v));
  } else if (def.type === "array") {
    const first = /** @type {unknown[]} */ (value).find((v) => v != null);
    def.item = first === undefined ? { key: "item", label: "Item", type: "json", required: false } : inferField("item", first);
    def.item.label = "Item";
  }
  return def;
}

/**
 * The control a value asks for.
 *
 * @param {string} key
 * @param {unknown} value
 * @returns {FieldType}
 */
export function inferType(key, value) {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    if (DATE_LIKE.test(value)) return HAS_TIME.test(value) ? "datetime" : "date";
    if (IMAGE_LIKE.test(value) || (IMAGE_KEYS.test(key) && value.length > 0)) return "image";
    if (TEXT_KEYS.has(key.toLowerCase()) || value.length > TEXT_MAX || value.includes("\n")) return "text";
    return "string";
  }
  if (value == null) return TEXT_KEYS.has(key.toLowerCase()) ? "text" : "string";
  if (Array.isArray(value)) {
    // A list of strings is tags; anything else is a list of typed items.
    return value.every((v) => typeof v === "string") ? "tags" : "array";
  }
  if (typeof value === "object") return "object";
  return "json";
}
