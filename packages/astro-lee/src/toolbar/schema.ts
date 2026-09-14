/**
 * Field definitions for a collection's frontmatter.
 *
 * The shape is the shared contract between the server (which derives it from
 * the Zod schema in `content.config.ts`) and the panel (which draws the right
 * control for each field). When the server has nothing to say — no config, no
 * schema, endpoint not there yet — `schemaFor()` infers a definition from the
 * values in the entry itself, marked `source: "inferred"`.
 *
 * The inference rules (`inferField`, `humanize`) live in `shared/infer.js`,
 * shared with the server so both sides agree on labels and types.
 */
import { humanize, inferField, inferType } from "../shared/infer.js";

export { humanize, inferField, inferType };
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
  integer?: boolean; // z.number().int(): step 1, no decimals
}

export interface CollectionSchema {
  collection: string;
  source: "zod" | "inferred"; // inferred = no schema found, types guessed from values (current behaviour)
  fields: FieldDef[];
}

/** `2026-09-01`, `2026-09-01T10:00:00Z`, `2026-09-01 10:00` … — a date we can put a picker on. */
export const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;

/** No server schema: guess a definition for every key from its value (the POC's `fieldKind`). */
export function schemaFor(collection: string, frontmatter: Record<string, unknown>): CollectionSchema {
  return {
    collection,
    source: "inferred",
    fields: Object.entries(frontmatter).map(([key, value]) => inferField(key, value)),
  };
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
      return def.integer ? Math.ceil(def.min ?? 0) : (def.min ?? 0);
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

