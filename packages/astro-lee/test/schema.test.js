import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CONFIG_CANDIDATES, fieldsFromJsonSchema, readCollectionSchema, templateFromSchema } from "../src/server/schema.js";
import { readFixture, tempRoot, writeFiles } from "./helpers";

const json = (name) => JSON.parse(readFixture(`schema/${name}.schema.json`));
const byKey = (fields) => Object.fromEntries(fields.map((f) => [f.key, f]));

describe("fieldsFromJsonSchema", () => {
  it("maps the demo blog schema (astro sync output)", () => {
    expect(fieldsFromJsonSchema(json("blog"))).toEqual([
      { key: "title", label: "Title", type: "string", required: true },
      { key: "description", label: "Description", type: "text", required: false, default: "" },
      { key: "pubDate", label: "Pub date", type: "date", required: true },
      { key: "tags", label: "Tags", type: "tags", required: false, default: [] },
      { key: "draft", label: "Draft", type: "boolean", required: false, default: false },
    ]);
  });

  it("maps the demo notes schema: enum, reference shape, integer bounds, descriptions", () => {
    const f = byKey(fieldsFromJsonSchema(json("notes")));
    expect(f.title).toEqual({ key: "title", label: "Title", type: "string", required: true, description: "Shown as the note's heading" });
    expect(f.kind).toEqual({ key: "kind", label: "Kind", type: "enum", required: false, default: "idea", options: ["idea", "todo", "reference"], description: "What sort of note this is" });
    expect(f.about).toEqual({ key: "about", label: "About", type: "reference", required: false, description: "The post this note is about" });
    // image() does not survive the JSON round trip on its own; readCollectionSchema fills it in from the config.
    expect(f.cover.type).toBe("string");
    expect(f.pinned).toEqual({ key: "pinned", label: "Pinned", type: "boolean", required: false });
    expect(f.priority).toEqual({ key: "priority", label: "Priority", type: "number", required: false, description: "1 is highest", min: 1, max: 5, integer: true });
    expect(f.updated).toEqual({ key: "updated", label: "Updated", type: "date", required: false });
    expect(Object.keys(f)).not.toContain("$schema");
  });

  it("maps every shape in the kitchen-sink schema", () => {
    const f = byKey(fieldsFromJsonSchema(json("kitchen")));
    expect(f.title).toMatchObject({ type: "string", required: true, min: 1, max: 80 });
    expect(f.summary).toMatchObject({ type: "text", required: false, max: 400 });
    expect(f.body).toMatchObject({ type: "string", required: true });
    expect(f.longText).toMatchObject({ type: "text", max: 500 });
    expect(f.status).toMatchObject({ type: "enum", options: ["draft", "live"], required: false, description: "Where it is" });
    expect(f.level).toMatchObject({ type: "enum", options: ["low", "high"], required: false });
    expect(f.score).toMatchObject({ type: "number", required: true, min: 0, max: 10 });
    expect(f.score.integer).toBeUndefined();
    expect(f.rank).toMatchObject({ type: "number", required: false, default: 3, min: 1, max: 5, integer: true });
    expect(f.stepped).toMatchObject({ type: "number", integer: true });
    expect(f.publishedAt).toMatchObject({ type: "datetime", required: true });
    expect(f.day).toMatchObject({ type: "date" });
    expect(f.when).toMatchObject({ type: "date", required: true });
    expect(f.maybeDate).toMatchObject({ type: "date", required: false });
    expect(f.labels).toMatchObject({ type: "tags", required: true });
    expect(f.kinds).toMatchObject({ type: "tags" });
    expect(f.links).toMatchObject({
      type: "array",
      required: true,
      item: { key: "item", label: "Item", type: "object", required: true, fields: [{ key: "href", label: "Href", type: "string", required: true }, { key: "label", label: "Label", type: "string", required: false }] },
    });
    expect(f.hero).toMatchObject({
      type: "object",
      required: true,
      fields: [{ key: "src", label: "Src", type: "string", required: true }, { key: "alt", label: "Alt", type: "string", required: false, default: "" }],
    });
    expect(f.related).toMatchObject({ type: "reference", required: true });
    expect(f.nullableName).toMatchObject({ type: "string", required: false });
    expect(f.anything).toMatchObject({ type: "json", required: true });
    expect(f.meta).toMatchObject({ type: "json" });
    expect(f.numbers).toMatchObject({ type: "json" });
    expect(f.flag).toMatchObject({ type: "boolean", required: true });
    expect(f.$schema).toBeUndefined();
  });

  it("returns null for anything that isn't an object schema", () => {
    expect(fieldsFromJsonSchema(null)).toBeNull();
    expect(fieldsFromJsonSchema({ type: "string" })).toBeNull();
    expect(fieldsFromJsonSchema({ $ref: "#/definitions/missing", definitions: {} })).toBeNull();
    expect(fieldsFromJsonSchema({ $ref: "#/definitions/a", definitions: { a: { $ref: "#/definitions/a" } } })).toBeNull();
  });
});

describe("readCollectionSchema", () => {
  const roots = [];
  afterAll(() => {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  });
  const makeRoot = (files) => {
    const root = tempRoot();
    roots.push(root);
    writeFiles(root, files);
    return root;
  };

  it("uses Astro's JSON Schema and fills in image() / reference() from the config source", async () => {
    const root = makeRoot({
      ".astro/collections/notes.schema.json": readFixture("schema/notes.schema.json"),
      "src/content.config.ts": readFixture("schema/content.config.ts"),
    });
    const schema = await readCollectionSchema({ root }, { name: "notes", entries: [] });
    expect(schema.source).toBe("zod");
    const f = byKey(schema.fields);
    expect(f.cover).toEqual({ key: "cover", label: "Cover", type: "image", required: false, description: "A picture for the note, next to the entry" });
    expect(f.about).toMatchObject({ type: "reference", collection: "blog" });
  });

  it("finds the config at any of Astro's candidate paths", async () => {
    expect(CONFIG_CANDIDATES[0]).toBe("src/content.config.ts");
    const root = makeRoot({
      ".astro/collections/notes.schema.json": readFixture("schema/notes.schema.json"),
      "src/content/config.js": 'const notes = { schema: { cover: image(), about: reference("blog") } };',
    });
    const f = byKey((await readCollectionSchema({ root }, { name: "notes", entries: [] })).fields);
    expect(f.cover.type).toBe("image");
    expect(f.about.collection).toBe("blog");
  });

  it("leaves the JSON types alone when there is no config to scan", async () => {
    const root = makeRoot({ ".astro/collections/notes.schema.json": readFixture("schema/notes.schema.json") });
    const f = byKey((await readCollectionSchema({ root }, { name: "notes", entries: [] })).fields);
    expect(f.cover.type).toBe("string");
    expect(f.about).not.toHaveProperty("collection");
  });

  it("infers from the entries' values when Astro has written no schema", async () => {
    const root = makeRoot({
      "src/content/til/one.md": "---\ntitle: One\nwhen: 2026-01-02\ntags: []\n---\nbody\n",
      "src/content/til/two.md": "---\ntitle: Two\ntags:\n  - a\ndraft: true\n---\nbody\n",
      "src/content/til/broken.md": "not readable as a document but still fine",
    });
    const schema = await readCollectionSchema({ root }, { name: "til", entries: [{ file: "src/content/til/one.md" }, { file: "src/content/til/two.md" }, { file: "src/content/til/broken.md" }, { file: "src/content/til/missing.md" }] });
    expect(schema).toEqual({
      collection: "til",
      source: "inferred",
      fields: [
        { key: "title", label: "Title", type: "string", required: false },
        { key: "when", label: "When", type: "date", required: false },
        // Empty in the first entry: the first non-empty value wins the type.
        { key: "tags", label: "Tags", type: "tags", required: false },
        { key: "draft", label: "Draft", type: "boolean", required: false },
      ],
    });
  });

  it("ignores a collection name that could escape .astro/collections", async () => {
    const root = makeRoot({ ".astro/collections/notes.schema.json": readFixture("schema/notes.schema.json") });
    const schema = await readCollectionSchema({ root }, { name: "../notes", entries: [] });
    expect(schema.source).toBe("inferred");
  });
});

describe("templateFromSchema", () => {
  it("fills defaults and required fields, in schema order, and skips optional ones", () => {
    const template = templateFromSchema({ collection: "blog", source: "zod", fields: fieldsFromJsonSchema(json("blog")) });
    expect(Object.keys(template)).toEqual(["title", "description", "pubDate", "tags", "draft"]);
    expect(template).toMatchObject({ title: "", description: "", tags: [], draft: false });
    expect(template.pubDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("picks an empty value of the right shape for every required type", () => {
    const f = byKey(fieldsFromJsonSchema(json("kitchen")));
    const template = templateFromSchema({ collection: "kitchen", source: "zod", fields: Object.values(f) });
    expect(template.title).toBe("");
    expect(template.body).toBe("");
    expect(template).not.toHaveProperty("status"); // nullable → not required
    expect(template.score).toBe(0);
    expect(template.rank).toBe(3);
    expect(template.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(template.when).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(template.labels).toEqual([]);
    expect(template.links).toEqual([]);
    expect(template.hero).toEqual({});
    expect(template.related).toBe("");
    expect(template.anything).toBeNull();
    expect(template.flag).toBe(false);
    expect(template).not.toHaveProperty("summary");
  });

  it("uses a number's minimum (rounded up for integers) and an enum's first option", () => {
    const fields = [
      { key: "n", label: "N", type: "number", required: true, min: 2.5, integer: true },
      { key: "m", label: "M", type: "number", required: true, min: 2.5 },
      { key: "e", label: "E", type: "enum", required: true, options: ["x", "y"] },
    ];
    expect(templateFromSchema({ collection: "c", source: "zod", fields })).toEqual({ n: 3, m: 2.5, e: "x" });
  });

  it("is empty for an inferred or missing schema", () => {
    expect(templateFromSchema(null)).toEqual({});
    expect(templateFromSchema({ collection: "c", source: "inferred", fields: [{ key: "title", label: "Title", type: "string", required: false }] })).toEqual({});
  });
});
