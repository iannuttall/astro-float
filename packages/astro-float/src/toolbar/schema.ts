/**
 * Shared contract: how a collection's frontmatter fields are described.
 *
 * Produced by the server (`src/server/schema.js`, from Astro's generated JSON
 * Schema plus the loaded Zod shapes for `image()` / `reference()`, or inferred
 * from values when there is no schema) and consumed by the panel.
 *
 * `GET /__float/api/schema?collection=<name>` → `CollectionSchema`; `api.schema(name)` on the client.
 */
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
  /** Humanized: `pubDate` → "Pub date". */
  label: string;
  type: FieldType;
  /** From `.describe()`. */
  description?: string;
  /** Not optional / no default / not nullable. */
  required: boolean;
  /** From `.default()`. */
  default?: unknown;
  /** enum */
  options?: string[];
  /** array */
  item?: FieldDef;
  /** object */
  fields?: FieldDef[];
  /** reference */
  collection?: string;
  /** number value / string length */
  min?: number;
  max?: number;
}

export interface CollectionSchema {
  collection: string;
  /** inferred = no schema found, types guessed from values. */
  source: "zod" | "inferred";
  fields: FieldDef[];
}
