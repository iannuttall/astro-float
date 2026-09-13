import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createEntry,
  discoverCollections,
  hashOf,
  httpError,
  isInside,
  isSafeSegment,
  listMedia,
  mediaKindOf,
  parseDocument,
  readEntry,
  resolveEntry,
  saveMedia,
  serializeDocument,
  slugify,
  writeEntry,
} from "../src/server/content.js";
import { readFixture, tempRoot, writeFiles } from "./helpers";

describe("parseDocument", () => {
  const raw = readFixture("content/kitchen.md");
  const { frontmatter, body, hadFrontmatter } = parseDocument(raw);

  it("keeps key order and scalar types, dates as the strings they were written as", () => {
    expect(hadFrontmatter).toBe(true);
    expect(Object.keys(frontmatter)).toEqual(["title", "description", "pubDate", "updated", "version", "flag", "draft", "count", "tags", "hero", "empty"]);
    expect(frontmatter.title).toBe("Quoted: title with a colon");
    expect(frontmatter.pubDate).toBe("2026-09-01");
    expect(frontmatter.updated).toBe("2026-09-01T10:30:00Z");
    expect(frontmatter.version).toBe("1.0");
    expect(frontmatter.flag).toBe("true");
    expect(frontmatter.draft).toBe(true);
    expect(frontmatter.count).toBe(3);
    expect(frontmatter.tags).toEqual(["astro", "with: colon"]);
    expect(frontmatter.hero).toEqual({ src: "./hero.png", alt: "" });
    expect(frontmatter.empty).toBeNull();
  });

  it("returns the body without the blank lines after the closing fence", () => {
    expect(body).toBe("First paragraph.\n\nSecond paragraph.\n");
  });

  it("copes with a BOM, CRLF line endings, no frontmatter, and non-mapping frontmatter", () => {
    expect(parseDocument("﻿---\r\ntitle: A\r\n---\r\n\r\nbody\r\n")).toEqual({ frontmatter: { title: "A" }, body: "body\r\n", hadFrontmatter: true });
    expect(parseDocument("just text\n")).toEqual({ frontmatter: {}, body: "just text\n", hadFrontmatter: false });
    expect(parseDocument("---\ntitle: A\n---")).toEqual({ frontmatter: { title: "A" }, body: "", hadFrontmatter: true });
    expect(parseDocument("---\n- a\n- b\n---\nbody\n").frontmatter).toEqual({});
    expect(parseDocument("---\njust a string\n---\nbody\n").frontmatter).toEqual({});
  });
});

describe("serializeDocument", () => {
  it("round-trips the demo entry byte for byte", () => {
    const raw = readFixture("content/canonical.md");
    const { frontmatter, body } = parseDocument(raw);
    expect(serializeDocument(frontmatter, body)).toBe(raw);
  });

  it("keeps key order, quotes only what YAML needs, and leaves date strings alone", () => {
    const out = serializeDocument(
      { z: "last first", title: "A: colon", when: "2026-09-01", at: "2026-09-01T10:30:00Z", n: "1.0", t: "true", ok: true, tags: ["a", "b: c"], nested: { x: 1 }, nothing: null },
      "body\n",
    );
    expect(out).toBe(
      ["---", "z: last first", 'title: "A: colon"', "when: 2026-09-01", "at: 2026-09-01T10:30:00Z", 'n: "1.0"', 't: "true"', "ok: true", "tags:", "  - a", '  - "b: c"', "nested:", "  x: 1", "nothing: null", "---", "", "body", ""].join("\n"),
    );
  });

  it("never wraps long lines", () => {
    const long = "word ".repeat(60).trim();
    expect(serializeDocument({ description: long }, "")).toContain(`description: ${long}\n`);
  });

  it("keeps the body byte for byte, minus leading blank lines, and ends with one newline", () => {
    expect(serializeDocument({ a: 1 }, "\n\nbody  \n  indented\n")).toBe("---\na: 1\n---\n\nbody  \n  indented\n");
    expect(serializeDocument({ a: 1 }, "no newline")).toBe("---\na: 1\n---\n\nno newline\n");
    expect(serializeDocument({}, "body\n")).toBe("---\n---\n\nbody\n");
    expect(serializeDocument(undefined, "")).toBe("---\n---\n\n\n");
  });

  it("parses back to the same data", () => {
    const data = { title: "A: colon", when: "2026-09-01", flag: "true", tags: ["x"], hero: { alt: "" } };
    expect(parseDocument(serializeDocument(data, "b\n")).frontmatter).toEqual(data);
  });
});

describe("small helpers", () => {
  it("slugify", () => {
    expect(slugify("Hello, Float!")).toBe("hello-float");
    expect(slugify("Café au lait")).toBe("cafe-au-lait");
    expect(slugify("  --Already--kebab--  ")).toBe("already-kebab");
    expect(slugify("")).toBe("");
  });

  it("isSafeSegment rejects path tricks", () => {
    expect(isSafeSegment("post")).toBe(true);
    expect(isSafeSegment("a.b")).toBe(true);
    for (const bad of ["", "../x", "a/b", "a\\b", ".hidden", "a..b", 42, null]) expect(isSafeSegment(bad), String(bad)).toBe(false);
  });

  it("isInside", () => {
    expect(isInside("/a/b", "/a/b/c")).toBe(true);
    expect(isInside("/a/b", "/a/b")).toBe(false);
    expect(isInside("/a/b", "/a/bc")).toBe(false);
    expect(isInside("/a/b", "/a/b/../c")).toBe(false);
  });

  it("hashOf is short, hex and stable", () => {
    expect(hashOf("x")).toMatch(/^[0-9a-f]{16}$/);
    expect(hashOf("x")).toBe(hashOf("x"));
    expect(hashOf("x")).not.toBe(hashOf("y"));
  });

  it("mediaKindOf and httpError", () => {
    expect(mediaKindOf("a.PNG")).toBe("image");
    expect(mediaKindOf("a.webm")).toBe("video");
    expect(mediaKindOf("a.txt")).toBeNull();
    expect(mediaKindOf(undefined)).toBeNull();
    const err = httpError(418, "teapot");
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(418);
    expect(err.message).toBe("teapot");
  });
});

describe("collections on disk", () => {
  const root = tempRoot();
  const ctx = { root, contentDir: path.join(root, "src/content"), collections: {}, publicDir: path.join(root, "public") };
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  writeFiles(root, {
    "src/content/blog/first-post/index.md": "---\ntitle: First\npubDate: 2026-01-01\ntags:\n  - a\ndraft: false\n---\n\nHello.\n",
    "src/content/blog/first-post/cover.png": "png",
    "src/content/blog/first-post/notes.txt": "not media",
    "src/content/blog/second-post/index.mdx": "---\ntitle: Second\nslug: custom-slug\n---\n\nimport X from './x.astro';\n\n<X />\n\nText.\n",
    "src/content/blog/loose.md": "---\ntitle: Loose\n---\n\nLoose body.\n",
    "src/content/blog/_draft.md": "---\ntitle: Hidden\n---\n",
    "src/content/notes/n.md": "no frontmatter\n",
    "src/content/empty/README.txt": "no markdown here",
    "src/content/.hidden/x.md": "---\ntitle: nope\n---\n",
  });

  it("discovers every directory holding Markdown, with ids Astro would give", async () => {
    const collections = await discoverCollections(ctx);
    expect(collections.map((c) => c.name)).toEqual(["blog", "notes"]);
    expect(collections[0].dir).toBe("src/content/blog");
    expect(collections[0].entries).toEqual([
      { id: "first-post", title: "First", file: "src/content/blog/first-post/index.md", folder: true },
      { id: "loose", title: "Loose", file: "src/content/blog/loose.md", folder: false },
      { id: "custom-slug", title: "Second", file: "src/content/blog/second-post/index.mdx", folder: true },
    ]);
    expect(collections[1].entries).toEqual([{ id: "n", title: "n", file: "src/content/notes/n.md", folder: false }]);
  });

  it("honours explicit collection options", async () => {
    const explicit = await discoverCollections({ ...ctx, collections: { posts: { dir: "src/content/blog", route: "/posts/[id]" }, nothing: {} } });
    expect(explicit.map((c) => [c.name, c.dir, c.route, c.entries.length])).toEqual([
      ["posts", "src/content/blog", "/posts/[id]", 3],
      ["nothing", "src/content/nothing", undefined, 0],
    ]);
  });

  it("resolves entries and refuses unknown ones", async () => {
    const { abs, entry } = await resolveEntry(ctx, "blog", "custom-slug");
    expect(abs).toBe(path.join(root, "src/content/blog/second-post/index.mdx"));
    expect(entry.folder).toBe(true);
    await expect(resolveEntry(ctx, "nope", "x")).rejects.toMatchObject({ status: 404 });
    await expect(resolveEntry(ctx, "blog", "missing")).rejects.toMatchObject({ status: 404 });
  });

  it("reads an entry with its blocks, hash and (inferred) schema", async () => {
    const doc = await readEntry(ctx, "blog", "custom-slug");
    expect(doc).toMatchObject({ collection: "blog", id: "custom-slug", mdx: true, folder: true, file: "src/content/blog/second-post/index.mdx" });
    expect(doc.absDir).toBe(path.join(root, "src/content/blog/second-post"));
    expect(doc.frontmatter).toEqual({ title: "Second", slug: "custom-slug" });
    expect(doc.lead).toBe("import X from './x.astro';");
    expect(doc.blocks.map((b) => [b.type, b.island])).toEqual([["mdxJsxFlowElement", true], ["paragraph", false]]);
    expect(doc.hash).toBe(hashOf(fs.readFileSync(path.join(root, doc.file), "utf8")));
    expect(doc.schema.source).toBe("inferred");
    expect(doc.schema.fields.map((f) => f.key)).toEqual(["title", "pubDate", "tags", "draft", "slug"]);
  });

  it("writes an entry, guards against stale hashes, and reports no-op writes", async () => {
    const before = await readEntry(ctx, "blog", "loose");
    const same = await writeEntry(ctx, { collection: "blog", id: "loose", frontmatter: before.frontmatter, body: before.body, baseHash: before.hash });
    expect(same).toMatchObject({ changed: false, hash: before.hash, file: "src/content/blog/loose.md" });

    const changed = await writeEntry(ctx, { collection: "blog", id: "loose", frontmatter: { ...before.frontmatter, draft: true }, body: "New body.\n", baseHash: before.hash });
    expect(changed).toMatchObject({ changed: true, body: "New body.\n" });
    expect(changed.blocks.map((b) => b.src)).toEqual(["New body."]);
    expect(fs.readFileSync(path.join(root, "src/content/blog/loose.md"), "utf8")).toBe("---\ntitle: Loose\ndraft: true\n---\n\nNew body.\n");

    await expect(writeEntry(ctx, { collection: "blog", id: "loose", frontmatter: {}, body: "x", baseHash: before.hash })).rejects.toMatchObject({ status: 409 });
    const forced = await writeEntry(ctx, { collection: "blog", id: "loose", frontmatter: { title: "Loose" }, body: "Forced.\n", baseHash: before.hash, force: true });
    expect(forced.changed).toBe(true);
    expect(fs.readFileSync(path.join(root, "src/content/blog/loose.md"), "utf8")).toBe("---\ntitle: Loose\n---\n\nForced.\n");
  });

  it("creates an entry in the collection's folder style with a template from its neighbours", async () => {
    const created = await createEntry(ctx, { collection: "blog", slug: "third-post", title: "Third post" });
    expect(created).toEqual({ collection: "blog", id: "third-post", file: "src/content/blog/third-post/index.md" });
    const raw = fs.readFileSync(path.join(root, created.file), "utf8");
    const { frontmatter, body } = parseDocument(raw);
    expect(frontmatter.title).toBe("Third post");
    expect(frontmatter.pubDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(frontmatter.tags).toEqual([]);
    expect(frontmatter.draft).toBe(false);
    expect(frontmatter).not.toHaveProperty("slug");
    expect(body).toBe("Start writing…\n");

    await expect(createEntry(ctx, { collection: "blog", slug: "third-post", title: "Again" })).rejects.toMatchObject({ status: 409 });
    await expect(createEntry(ctx, { collection: "blog", slug: "Not Kebab", title: "x" })).rejects.toMatchObject({ status: 400 });
    await expect(createEntry(ctx, { collection: "blog", slug: "../escape", title: "x" })).rejects.toMatchObject({ status: 400 });
    await expect(createEntry(ctx, { collection: "nope", slug: "a", title: "x" })).rejects.toMatchObject({ status: 404 });
  });

  it("creates a flat file when the collection is mostly flat files, and passes frontmatter through", async () => {
    const created = await createEntry(ctx, { collection: "notes", slug: "second", title: "Second note", frontmatter: { kind: "todo" } });
    expect(created.file).toBe("src/content/notes/second.md");
    expect(parseDocument(fs.readFileSync(path.join(root, created.file), "utf8")).frontmatter).toEqual({ kind: "todo", title: "Second note" });
  });

  it("saves images next to the entry and videos under public/media, without overwriting", async () => {
    const png = await saveMedia(ctx, "blog", "first-post", "My Photo.PNG", Buffer.from("png1"));
    expect(png).toEqual({ name: "my-photo.png", kind: "image", src: "./my-photo.png", url: "/@fs" + path.join(root, "src/content/blog/first-post/my-photo.png"), file: "src/content/blog/first-post/my-photo.png" });
    const again = await saveMedia(ctx, "blog", "first-post", "my-photo.png", Buffer.from("png2"));
    expect(again.name).toBe("my-photo-2.png");
    expect(fs.readFileSync(path.join(root, "src/content/blog/first-post/my-photo.png"), "utf8")).toBe("png1");

    const flat = await saveMedia(ctx, "blog", "loose", "shot.jpg", Buffer.from("jpg"));
    expect(flat.src).toBe("./loose/shot.jpg");
    expect(flat.file).toBe("src/content/blog/loose/shot.jpg");

    const video = await saveMedia(ctx, "blog", "first-post", "Clip One.mp4", Buffer.from("mp4"));
    expect(video).toMatchObject({ name: "clip-one.mp4", kind: "video", src: "/media/blog/first-post/clip-one.mp4", file: "public/media/blog/first-post/clip-one.mp4" });
    expect(fs.existsSync(path.join(root, "public/media/blog/first-post/clip-one.mp4"))).toBe(true);

    await expect(saveMedia(ctx, "blog", "first-post", "notes.txt", Buffer.from("x"))).rejects.toMatchObject({ status: 415 });
  });

  it("lists only the images next to an entry, sorted", async () => {
    const media = await listMedia(ctx, "blog", "first-post");
    expect(media.map((m) => m.name)).toEqual(["cover.png", "my-photo-2.png", "my-photo.png"]);
    expect(media[0]).toEqual({ name: "cover.png", src: "./cover.png", url: "/@fs" + path.join(root, "src/content/blog/first-post/cover.png") });
    expect(await listMedia(ctx, "blog", "custom-slug")).toEqual([]);
    expect((await listMedia(ctx, "blog", "loose")).map((m) => m.src)).toEqual(["./loose/shot.jpg"]);
  });
});
