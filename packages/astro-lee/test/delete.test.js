import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { deleteCollection } from "../src/server/collections.js";
import { deleteEntry, discoverCollections } from "../src/server/content.js";
import { tempRoot, writeFiles } from "./helpers";

describe("deleteEntry", () => {
  const root = tempRoot();
  const ctx = { root, contentDir: path.join(root, "src/content"), collections: {}, publicDir: path.join(root, "public") };
  const has = (p) => fs.existsSync(path.join(root, p));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  writeFiles(root, {
    "src/content/blog/hello/index.md": "---\ntitle: Hello\n---\n\n![pic](./pic.png)\n",
    "src/content/blog/hello/pic.png": "png",
    "src/content/blog/keep/index.md": "---\ntitle: Keep\n---\n\nx\n",
    "src/content/blog/2024/deep/index.md": "---\ntitle: Deep\n---\n\nx\n",
    "src/content/notes/loose.md": "---\ntitle: Loose\n---\n\n![shot](./loose/shot.jpg)\n",
    "src/content/notes/loose/shot.jpg": "jpg",
    "src/content/notes/plain.md": "---\ntitle: Plain\n---\n\nx\n",
    "public/media/blog/hello/clip.mp4": "mp4",
    "public/media/blog/keep/clip.mp4": "mp4",
  });

  it("removes a folder entry with its images and public media, and nothing else", async () => {
    const result = await deleteEntry(ctx, "blog", "hello");
    expect(result).toEqual({ collection: "blog", id: "hello", file: "src/content/blog/hello/index.md", removed: ["src/content/blog/hello", "public/media/blog/hello"] });
    expect(has("src/content/blog/hello")).toBe(false);
    expect(has("public/media/blog/hello")).toBe(false);
    expect(has("src/content/blog/keep/index.md")).toBe(true);
    expect(has("public/media/blog/keep/clip.mp4")).toBe(true);
    expect((await discoverCollections(ctx)).find((c) => c.name === "blog").entries.map((e) => e.id)).toEqual(["2024/deep", "keep"]);
  });

  it("removes a flat entry with its upload folder; a flat entry without one just goes", async () => {
    expect(await deleteEntry(ctx, "notes", "loose")).toMatchObject({ removed: ["src/content/notes/loose.md", "src/content/notes/loose"] });
    expect(has("src/content/notes/loose.md")).toBe(false);
    expect(has("src/content/notes/loose")).toBe(false);
    expect(await deleteEntry(ctx, "notes", "plain")).toMatchObject({ removed: ["src/content/notes/plain.md"] });
    expect(has("src/content/notes")).toBe(true);
  });

  it("removes a nested folder entry, leaving its parent folder", async () => {
    await deleteEntry(ctx, "blog", "2024/deep");
    expect(has("src/content/blog/2024/deep")).toBe(false);
    expect(has("src/content/blog/2024")).toBe(true);
  });

  it("refuses unknown entries and collections", async () => {
    await expect(deleteEntry(ctx, "blog", "hello")).rejects.toMatchObject({ status: 404 });
    await expect(deleteEntry(ctx, "nope", "keep")).rejects.toMatchObject({ status: 404 });
    await expect(deleteEntry(ctx, "blog", "../keep")).rejects.toMatchObject({ status: 404 });
  });
});

describe("deleteCollection", () => {
  const root = tempRoot();
  const ctx = { root, contentDir: path.join(root, "src/content"), collections: {}, publicDir: path.join(root, "public") };
  const has = (p) => fs.existsSync(path.join(root, p));
  const config = () => fs.readFileSync(path.join(root, "src/content.config.ts"), "utf8");
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const INLINE = [
    `import { defineCollection, z } from "astro:content";`,
    `import { glob } from "astro/loaders";`,
    ``,
    `const blog = defineCollection({`,
    `  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),`,
    `  schema: z.object({ title: z.string(), tags: z.array(z.string()).default([]) }), // (a comment)`,
    `});`,
    ``,
    `const notesCollection = defineCollection({`,
    `  loader: glob({ pattern: "**/*.md", base: "./src/content/notes" }),`,
    `  schema: ({ image }) => z.object({ title: z.string(), cover: image().optional() }),`,
    `});`,
    ``,
    `const til = defineCollection({ loader: glob({ pattern: "**/*.md", base: "./src/content/til" }) });`,
    ``,
    `export const collections = { blog, "notes": notesCollection, til };`,
    ``,
  ].join("\n");

  writeFiles(root, {
    "src/content/blog/a/index.md": "---\ntitle: A\n---\n\nx\n",
    "src/content/blog/b/index.md": "---\ntitle: B\n---\n\nx\n",
    "src/content/notes/n.md": "---\ntitle: N\n---\n\nx\n",
    "src/content/til/t.md": "---\ntitle: T\n---\n\nx\n",
    "src/content/loose/l.md": "---\ntitle: L\n---\n\nx\n",
    "public/media/blog/a/clip.mp4": "mp4",
    "public/media/notes/n/clip.mp4": "mp4",
    "src/content.config.ts": INLINE,
  });

  it("removes the folder and its public media, and takes the block and key out of an inline export", async () => {
    const result = await deleteCollection(ctx, "blog");
    expect(result).toEqual({ collection: "blog", entries: 2, removed: ["src/content/blog", "public/media/blog"], config: { file: "src/content.config.ts", updated: true } });
    expect(has("src/content/blog")).toBe(false);
    expect(has("public/media/blog")).toBe(false);
    expect(has("public/media/notes/n/clip.mp4")).toBe(true);
    expect(config()).toBe(
      [
        `import { defineCollection, z } from "astro:content";`,
        `import { glob } from "astro/loaders";`,
        ``,
        `const notesCollection = defineCollection({`,
        `  loader: glob({ pattern: "**/*.md", base: "./src/content/notes" }),`,
        `  schema: ({ image }) => z.object({ title: z.string(), cover: image().optional() }),`,
        `});`,
        ``,
        `const til = defineCollection({ loader: glob({ pattern: "**/*.md", base: "./src/content/til" }) });`,
        ``,
        `export const collections = { "notes": notesCollection, til };`,
        ``,
      ].join("\n"),
    );
  });

  it("follows a quoted key to its variable, and a one-line definition", async () => {
    await deleteCollection(ctx, "notes");
    await deleteCollection(ctx, "til");
    expect(config()).toBe([`import { defineCollection, z } from "astro:content";`, `import { glob } from "astro/loaders";`, ``, `export const collections = {};`, ``].join("\n"));
  });

  it("deletes the folder but leaves an unrecognised config alone, and says so", async () => {
    writeFiles(root, { "src/content/x/one.md": "---\ntitle: One\n---\n\nx\n" });
    const result = await deleteCollection(ctx, "loose");
    expect(result.config).toEqual({ file: "src/content.config.ts", updated: false, note: '"loose" isn\'t registered in src/content.config.ts' });
    expect(has("src/content/loose")).toBe(false);

    fs.writeFileSync(path.join(root, "src/content.config.ts"), `export default { x: 1 };\n`);
    const odd = await deleteCollection(ctx, "x");
    expect(odd.config.updated).toBe(false);
    expect(odd.config.note).toMatch(/couldn't find/);
    expect(has("src/content/x")).toBe(false);
    expect(config()).toBe(`export default { x: 1 };\n`);
  });

  it("keeps a multi-line export's shape", async () => {
    writeFiles(root, {
      "src/content/p/one.md": "---\ntitle: One\n---\n\nx\n",
      "src/content/q/one.md": "---\ntitle: One\n---\n\nx\n",
      "src/content.config.ts": [`const p = defineCollection({ loader: glob({ base: "./src/content/p" }) });`, `const q = defineCollection({ loader: glob({ base: "./src/content/q" }) });`, ``, `export const collections = {`, `  p,`, `  q,`, `};`, ``].join("\n"),
    });
    await deleteCollection(ctx, "p");
    expect(config()).toBe([`const q = defineCollection({ loader: glob({ base: "./src/content/q" }) });`, ``, `export const collections = {`, `  q,`, `};`, ``].join("\n"));
  });

  it("refuses unknown names, bad names, and a directory outside the content dir", async () => {
    await expect(deleteCollection(ctx, "nope")).rejects.toMatchObject({ status: 404 });
    await expect(deleteCollection(ctx, "../etc")).rejects.toMatchObject({ status: 400 });
    writeFiles(root, { "elsewhere/e.md": "---\ntitle: E\n---\n\nx\n" });
    const outside = { ...ctx, collections: { away: { dir: "elsewhere" } } };
    await expect(deleteCollection(outside, "away")).rejects.toMatchObject({ status: 400 });
    expect(has("elsewhere/e.md")).toBe(true);
  });
});

describe("deleteEntry around other entries", () => {
  const root = tempRoot();
  const ctx = { root, contentDir: path.join(root, "src/content"), collections: {}, publicDir: path.join(root, "public") };
  const has = (p) => fs.existsSync(path.join(root, p));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  writeFiles(root, {
    "src/content/docs/index.md": "---\ntitle: Docs\n---\n\nx\n",
    "src/content/docs/guide/index.md": "---\ntitle: Guide\n---\n\n![map](./map.png)\n",
    "src/content/docs/guide/map.png": "png",
    "src/content/docs/guide/install.md": "---\ntitle: Install\n---\n\nx\n",
    "src/content/docs/faq.md": "---\ntitle: FAQ\n---\n\nx\n",
    "src/content/docs/faq/more/index.md": "---\ntitle: More\n---\n\nx\n",
    "src/content/docs/odd.md": "---\ntitle: Odd\nslug: ../blog\n---\n\nx\n",
    "public/media/docs/guide/intro.mp4": "mp4",
    "public/media/docs/guide/install/demo.mp4": "mp4",
    "public/media/blog/clip.mp4": "mp4",
  });

  it("a folder entry with entries inside loses only its own file and the videos directly in its media folder", async () => {
    expect((await deleteEntry(ctx, "docs", "guide")).removed).toEqual(["src/content/docs/guide/index.md", "public/media/docs/guide/intro.mp4"]);
    expect(has("src/content/docs/guide/install.md")).toBe(true);
    expect(has("src/content/docs/guide/map.png")).toBe(true);
    expect(has("public/media/docs/guide/install/demo.mp4")).toBe(true);
  });

  it("a flat entry keeps a same-named folder that holds entries", async () => {
    expect((await deleteEntry(ctx, "docs", "faq")).removed).toEqual(["src/content/docs/faq.md"]);
    expect(has("src/content/docs/faq/more/index.md")).toBe(true);
  });

  it("an index.md at the collection root goes alone, never the collection", async () => {
    expect((await deleteEntry(ctx, "docs", "index")).removed).toEqual(["src/content/docs/index.md"]);
    expect(has("src/content/docs/faq/more/index.md")).toBe(true);
  });

  it("an id from a frontmatter slug never reaches another collection's media", async () => {
    expect((await deleteEntry(ctx, "docs", "../blog")).removed).toEqual(["src/content/docs/odd.md"]);
    expect(has("public/media/blog/clip.mp4")).toBe(true);
  });
});
