import type { FieldDef } from "./toolbar/schema";

export type { FieldDef };

/** Lee's field list for a collection, from the JSON Schema Astro writes to `.astro/collections/<name>.schema.json`. Null when it isn't an object schema. */
export function fieldsFromJsonSchema(doc: unknown): FieldDef[] | null;
