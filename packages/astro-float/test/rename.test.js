import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isValidSlug, slugError } from "../src/shared/slug.js";
import { discoverCollections, hashOf, readEntry, renameEntry } from "../src/server/content.js";
import { tempRoot, writeFiles } from "./helpers";

describe("slug rules", () => {
  it("accepts lowercase letters, digits and single dashes", () => {
    for (const ok of ["a", "hello-float", "2024", "v1-2-3", "x".repeat(200)]) {
      expect(isValidSlug(ok), ok).toBe(true);
      expect(slugError(ok), ok).toBeNull();
    }
  });

  it("says what is wrong, in the popover's words", () => {
    expect(slugError("")).toBe("Give it an address");
    expect(slugError(undefined)).toBe("Give it an address");
    expect(slugError("Hello")).toBe("Lowercase only");
    expect(slugError("hello world")).toBe("Letters, numbers and dashes only");
    expect(slugError("héllo")).toBe("Letters, numbers and dashes only");
    expect(slugError("a/b")).toBe("Letters, numbers and dashes only");
    expect(slugError("../x")).toBe("Letters, numbers and dashes only");
    expect(slugError("-hello")).toBe("Can't start or end with a dash");
    expect(slugError("hello-")).toBe("Can't start or end with a dash");
    expect(slugError("hello--float")).toBe("One dash at a time");
    expect(slugError("x".repeat(201))).toBe("Too long");
    for (const bad of ["", "Hello", "a b", "-a", "a-", "a--b", ".", "..", "a.b", "a_b"]) expect(isValidSlug(bad), bad).toBe(false);
  });
});

describe("renameEntry", () => {
  const root = tempRoot();
  const ctx = { root, contentDir: path.join(root, "src/content"), collections: {}, publicDir: path.join(root, "public") };
  const rel = (p) => path.join(root, p);
  const has = (p) => fs.existsSync(rel(p));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  writeFiles(root, {
    "src/content/blog/hello/index.md": "---\ntitle: Hello\ndraft: false\n---\n\n![pic](./pic.png)\n\n<video src=\"/media/blog/hello/clip.mp4\"></video>\n",
    "src/content/blog/hello/pic.png": "png",
    "src/content/blog/taken/index.md": "---\ntitle: Taken\n---\n\nx\n",
    "src/content/blog/pinned/index.md": "---\ntitle: Pinned\nslug: pinned\n---\n\nx\n",
    "src/content/blog/2024/deep/index.md": "---\ntitle: Deep\n---\n\nx\n",
    "src/content/notes/loose.md": "---\ntitle: Loose\ncover: ./loose/cover.png\n---\n\n![shot](./loose/shot.jpg) and (loose/shot.jpg)\n\nNot a link: unloose/x.png\n",
    "src/content/notes/loose/cover.png": "png",
    "src/content/notes/loose/shot.jpg": "jpg",
    "src/content/notes/plain.mdx": "---\ntitle: Plain\n---\n\nx\n",
    "public/media/blog/hello/clip.mp4": "mp4",
  });

  it("refuses bad slugs, unknown entries, taken addresses, stale hashes and frontmatter slugs", async () => {
    await expect(renameEntry(ctx, { collection: "blog", id: "hello", slug: "Hello" })).rejects.toMatchObject({ status: 400, message: "Lowercase only" });
    await expect(renameEntry(ctx, { collection: "blog", id: "hello", slug: "../up" })).rejects.toMatchObject({ status: 400 });
    await expect(renameEntry(ctx, { collection: "blog", id: "hello", slug: "" })).rejects.toMatchObject({ status: 400 });
    await expect(renameEntry(ctx, { collection: "blog", id: "missing", slug: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(renameEntry(ctx, { collection: "nope", id: "hello", slug: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(renameEntry(ctx, { collection: "blog", id: "hello", slug: "taken" })).rejects.toMatchObject({ status: 409, message: '"taken" is taken' });
    await expect(renameEntry(ctx, { collection: "blog", id: "hello", slug: "fresh", baseHash: "0000000000000000" })).rejects.toMatchObject({ status: 409 });
    await expect(renameEntry(ctx, { collection: "blog", id: "pinned", slug: "fresh" })).rejects.toMatchObject({ status: 400, message: /slug field/ });
    expect(has("src/content/blog/hello/index.md")).toBe(true);
    expect(has("src/content/blog/fresh")).toBe(false);
  });

  it("is a no-op when the address is the same", async () => {
    const before = await readEntry(ctx, "blog", "hello");
    const same = await renameEntry(ctx, { collection: "blog", id: "hello", slug: "hello", baseHash: before.hash });
    expect(same).toEqual({ collection: "blog", id: "hello", file: "src/content/blog/hello/index.md", route: "/blog/hello/", hash: before.hash, changed: false });
  });

  it("renames a folder entry: the folder, its images and its public media move; public URLs in the text follow", async () => {
    const before = await readEntry(ctx, "blog", "hello");
    const renamed = await renameEntry(ctx, { collection: "blog", id: "hello", slug: "hello-again", baseHash: before.hash });
    expect(renamed).toMatchObject({ collection: "blog", id: "hello-again", file: "src/content/blog/hello-again/index.md", route: "/blog/hello-again/", changed: true });

    expect(has("src/content/blog/hello")).toBe(false);
    expect(has("src/content/blog/hello-again/pic.png")).toBe(true);
    expect(has("public/media/blog/hello")).toBe(false);
    expect(fs.readFileSync(rel("public/media/blog/hello-again/clip.mp4"), "utf8")).toBe("mp4");

    const text = fs.readFileSync(rel("src/content/blog/hello-again/index.md"), "utf8");
    expect(text).toBe("---\ntitle: Hello\ndraft: false\n---\n\n![pic](./pic.png)\n\n<video src=\"/media/blog/hello-again/clip.mp4\"></video>\n");
    expect(renamed.hash).toBe(hashOf(text));

    const ids = (await discoverCollections(ctx)).find((c) => c.name === "blog").entries.map((e) => e.id);
    expect(ids).toContain("hello-again");
    expect(ids).not.toContain("hello");
  });

  it("renames a flat entry: the file and its upload folder move, and the links to it are rewritten", async () => {
    const renamed = await renameEntry(ctx, { collection: "notes", id: "loose", slug: "tight" });
    expect(renamed).toMatchObject({ id: "tight", file: "src/content/notes/tight.md", route: "/notes/tight/", changed: true });
    expect(has("src/content/notes/loose.md")).toBe(false);
    expect(has("src/content/notes/loose")).toBe(false);
    expect(has("src/content/notes/tight/cover.png")).toBe(true);
    expect(has("src/content/notes/tight/shot.jpg")).toBe(true);
    expect(fs.readFileSync(rel("src/content/notes/tight.md"), "utf8")).toBe(
      "---\ntitle: Loose\ncover: ./tight/cover.png\n---\n\n![shot](./tight/shot.jpg) and (tight/shot.jpg)\n\nNot a link: unloose/x.png\n",
    );
  });

  it("keeps the extension of a flat entry and leaves the text alone when nothing referenced the old name", async () => {
    const before = fs.readFileSync(rel("src/content/notes/plain.mdx"), "utf8");
    const renamed = await renameEntry(ctx, { collection: "notes", id: "plain", slug: "simple" });
    expect(renamed.file).toBe("src/content/notes/simple.mdx");
    expect(fs.readFileSync(rel("src/content/notes/simple.mdx"), "utf8")).toBe(before);
    expect(renamed.hash).toBe(hashOf(before));
  });

  it("edits only the last segment of a nested id", async () => {
    const renamed = await renameEntry(ctx, { collection: "blog", id: "2024/deep", slug: "deeper" });
    expect(renamed).toMatchObject({ id: "2024/deeper", file: "src/content/blog/2024/deeper/index.md", route: "/blog/2024/deeper/" });
    expect(has("src/content/blog/2024/deep")).toBe(false);
    expect(has("src/content/blog/2024/deeper/index.md")).toBe(true);
  });

  it("fills a configured route pattern", async () => {
    const pinned = { ...ctx, collections: { blog: { route: "/posts/[...id]" } } };
    const renamed = await renameEntry(pinned, { collection: "blog", id: "2024/deeper", slug: "deepest" });
    expect(renamed.route).toBe("/posts/2024/deepest");
  });
});
