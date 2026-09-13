/**
 * Field definitions for a collection's frontmatter.
 *
 * The shape is the shared contract between the server (which derives it from
 * the Zod schema in `content.config.ts`) and the panel (which draws the right
 * control for each field). When the server has nothing to say — no config, no
 * schema, endpoint not there yet — `schemaFor()` infers a definition from the
 * values in the entry itself, marked `source: "inferred"`.
 */
import { clone } from "./panel/util";

export type FieldType =
  | "string"
  | "text" // long string: description-like, or z.string() with .max > 160 / key named description|summary|excerpt
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "enum" // options: string[]
  | "tags" // z.array(z.string())
  | "image" // image() helper from astro:content
  | "object" // fields: FieldDef[] (nested)
  | "array" // item: FieldDef (non-string arrays)
  | "reference" // reference("collection") → options come from that collection's entries
  | "json"; // anything else, edited as JSON

export interface FieldDef {
  key: string;
  label: string; // humanized
  type: FieldType;
  description?: string; // from .describe()
  required: boolean; // not optional / no default / not nullable
  default?: unknown; // from .default()
  options?: string[]; // enum
  item?: FieldDef; // array
  fields?: FieldDef[]; // object
  collection?: string; // reference
  min?: number;
  max?: number; // number / string length
  integer?: boolean; // z.number().int()
}

export interface CollectionSchema {
  collection: string;
  source: "zod" | "inferred"; // inferred = no schema found, types guessed from values (current behaviour)
  fields: FieldDef[];
}

/** `2026-09-01`, `2026-09-01T10:00:00Z`, `2026-09-01 10:00` … — a date we can put a picker on. */
export const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;
const HAS_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const IMAGE_LIKE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const TEXT_KEYS = new Set(["description", "summary", "excerpt", "abstract", "intro", "lede"]);
const IMAGE_KEYS = /^(image|cover|coverImage|heroImage|hero|thumbnail|thumb|ogImage|photo|banner)$/i;

/** No server schema: guess a definition for every key from its value (the POC's `fieldKind`). */
export function schemaFor(collection: string, frontmatter: Record<string, unknown>): CollectionSchema {
  return {
    collection,
    source: "inferred",
    fields: Object.entries(frontmatter).map(([key, value]) => inferField(key, value)),
  };
}

/** A definition for one key, from its value alone. */
export function inferField(key: string, value: unknown): FieldDef {
  const def: FieldDef = { key, label: humanize(key), type: inferType(key, value), required: false };
  if (def.type === "object") {
    const obj = (value ?? {}) as Record<string, unknown>;
    def.fields = Object.entries(obj).map(([k, v]) => inferField(k, v));
  } else if (def.type === "array") {
    const first = (value as unknown[])[0];
    def.item = inferField("item", first);
    def.item.label = "Item";
  }
  return def;
}

function inferType(key: string, value: unknown): FieldType {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    if (DATE_LIKE.test(value)) return HAS_TIME.test(value) ? "datetime" : "date";
    if (IMAGE_LIKE.test(value) || (IMAGE_KEYS.test(key) && value.length > 0)) return "image";
    if (TEXT_KEYS.has(key) || value.length > 80 || value.includes("\n")) return "text";
    return "string";
  }
  if (value == null) return TEXT_KEYS.has(key) ? "text" : "string";
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string" || typeof v === "number")) return "tags";
    if (value.length > 0 && value.every((v) => v && typeof v === "object" && !Array.isArray(v))) return "array";
    return "json";
  }
  if (typeof value === "object") return "object";
  return "json";
}

/** `pubDate` → "Pub date", `hero_image` → "Hero image", `ogImage` → "Og image". */
export function humanize(key: string): string {
  const words = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const KEY_HELP: Record<string, string> = {
  title: "Shown as the heading and in lists",
  description: "One or two sentences for lists and meta tags",
  summary: "Short summary shown in lists",
  excerpt: "Short excerpt shown in lists",
  pubDate: "Publication date",
  publishDate: "Publication date",
  publishedAt: "Publication date",
  date: "Publication date",
  updatedDate: "Last updated",
  updatedAt: "Last updated",
  tags: "Keywords for grouping and filtering",
  categories: "Groups this entry belongs to",
  category: "Group this entry belongs to",
  draft: "Drafts are left out of production builds",
  published: "Off keeps it out of production builds",
  featured: "Highlight this entry",
  author: "Who wrote it",
  slug: "URL segment, from the file name",
  image: "Cover image",
  cover: "Cover image",
  coverImage: "Cover image",
  heroImage: "Cover image",
  ogImage: "Preview image for social links",
  canonicalURL: "The URL search engines should treat as original",
  lang: "Language code, like en or fr",
  order: "Position in lists",
  weight: "Position in lists",
};

/** One line of help under the label: the schema's `.describe()`, else a sensible default for the key or type. */
export function helpFor(def: FieldDef): string {
  if (def.description) return def.description;
  const byKey = KEY_HELP[def.key];
  if (byKey) return byKey;
  switch (def.type) {
    case "boolean":
      return "Yes or no";
    case "number":
      return def.min != null || def.max != null ? `A number${def.min != null ? ` from ${def.min}` : ""}${def.max != null ? ` to ${def.max}` : ""}` : "A number";
    case "date":
      return "A date";
    case "datetime":
      return "A date and time";
    case "enum":
      return `One of ${def.options?.length ?? 0} options`;
    case "tags":
      return "A list of words";
    case "image":
      return "An image next to this entry";
    case "object":
      return "A group of fields";
    case "array":
      return "A list of items";
    case "reference":
      return def.collection ? `An entry in ${def.collection}` : "Another entry";
    case "json":
      return "Edited as JSON";
    case "text":
      return "Free text";
    default:
      return "Short text";
  }
}

/** A starting value for a field that has no value yet. */
export function emptyValue(def: FieldDef): unknown {
  if (def.default !== undefined) return clone(def.default);
  switch (def.type) {
    case "boolean":
      return false;
    case "number":
      return def.min ?? 0;
    case "date":
      return new Date().toISOString().slice(0, 10);
    case "datetime":
      return new Date().toISOString().slice(0, 16) + ":00Z";
    case "enum":
      return def.options?.[0] ?? "";
    case "tags":
    case "array":
      return [];
    case "object": {
      const out: Record<string, unknown> = {};
      for (const f of def.fields ?? []) if (f.required) out[f.key] = emptyValue(f);
      return out;
    }
    case "json":
      return null;
    default:
      return "";
  }
}

