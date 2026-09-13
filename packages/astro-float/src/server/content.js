import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { splitBlocks } from "./blocks.js";
import { readCollectionSchema, templateFromSchema } from "./schema.js";
import { validateDocument, validationError } from "./validate.js";

export const ENTRY_EXTS = new Set([".md", ".mdx", ".markdown"]);
export const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"]);
export const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".m4v"]);

/** "image" | "video" | null for a file name. */
export function mediaKindOf(filename) {
  const ext = path.extname(String(filename ?? "")).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  return null;
}

const FRONTMATTER_RE = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** @param {string} s */
export function hashOf(s) {
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

/** Split a Markdown document into frontmatter data + body. */
export function parseDocument(raw) {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: raw, hadFrontmatter: false };
  let data = parseYaml(match[1], { schema: "core" });
  if (data === null || typeof data !== "object" || Array.isArray(data)) data = {};
  const body = raw.slice(match[0].length).replace(/^(\r?\n)+/, "");
  return { frontmatter: data, body, hadFrontmatter: true };
}

/**
 * Serialize frontmatter + body back to a Markdown document.
 * Body is kept byte-for-byte; frontmatter is re-emitted through the YAML
 * stringifier (key order preserved, quoting normalized).
 */
export function serializeDocument(frontmatter, body) {
  const keys = Object.keys(frontmatter ?? {});
  const yaml = keys.length ? stringifyYaml(frontmatter, { lineWidth: 0 }) : "";
  const cleanBody = body.replace(/^\r?\n+/, "");
  const trailing = cleanBody.endsWith("\n") ? "" : "\n";
  return `---\n${yaml}---\n\n${cleanBody}${trailing}`;
}

/** @param {string} value */
export function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Reject anything that could walk out of a directory. */
export function isSafeSegment(value) {
  return typeof value === "string" && value.length > 0 && !/[\\/]|^\.|\.\./.test(value);
}

/** @param {string} base @param {string} target */
export function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Astro-ish entry id: path relative to the collection dir, no extension, `/index` dropped. */
function idForFile(collectionDir, file) {
  const rel = path.relative(collectionDir, file).split(path.sep).join("/");
  const noExt = rel.replace(/\.[^.]+$/, "");
  return noExt.replace(/(^|\/)index$/, "") || "index";
}

async function walk(dir, out = []) {
  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirents) {
    if (d.name.startsWith("_") || d.name.startsWith(".")) continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) await walk(full, out);
    else if (ENTRY_EXTS.has(path.extname(d.name).toLowerCase())) out.push(full);
  }
  return out;
}

/**
 * Discover collections. Explicit `collections` options win; otherwise every
 * directory directly under `contentDir` that holds Markdown is a collection.
 *
 * @param {{ contentDir: string, root: string, collections: Record<string, { dir?: string, route?: string }> }} ctx
 */
export async function discoverCollections(ctx) {
  /** @type {Array<{ name: string, dir: string, route?: string }>} */
  const found = [];

  const explicit = Object.entries(ctx.collections ?? {});
  if (explicit.length) {
    for (const [name, def] of explicit) {
      const dir = def.dir ? path.resolve(ctx.root, def.dir) : path.join(ctx.contentDir, name);
      found.push({ name, dir, route: def.route });
    }
  } else {
    let dirents = [];
    try {
      dirents = await fs.readdir(ctx.contentDir, { withFileTypes: true });
    } catch {
      /* no content dir yet */
    }
    for (const d of dirents) {
      if (!d.isDirectory() || d.name.startsWith("_") || d.name.startsWith(".")) continue;
      found.push({ name: d.name, dir: path.join(ctx.contentDir, d.name) });
    }
  }

  const collections = [];
  for (const c of found) {
    const files = await walk(c.dir);
    const entries = [];
    for (const file of files.sort()) {
      let title;
      let slugOverride;
      try {
        const { frontmatter } = parseDocument(await fs.readFile(file, "utf8"));
        if (typeof frontmatter.title === "string") title = frontmatter.title;
        if (typeof frontmatter.slug === "string") slugOverride = frontmatter.slug;
      } catch {
        /* unreadable; still list it */
      }
      const id = slugOverride ?? idForFile(c.dir, file);
      entries.push({
        id,
        title: title ?? id,
        file: path.relative(ctx.root, file).split(path.sep).join("/"),
        folder: path.basename(file).replace(/\.[^.]+$/, "") === "index",
      });
    }
    if (explicit.length || entries.length) {
      collections.push({
        name: c.name,
        dir: path.relative(ctx.root, c.dir).split(path.sep).join("/"),
        route: c.route,
        entries,
      });
    }
  }
  return collections;
}

/**
 * Resolve a (collection, id) pair to an absolute file path. Throws 404-ish errors.
 */
export async function resolveEntry(ctx, collectionName, id) {
  const collections = await discoverCollections(ctx);
  const collection = collections.find((c) => c.name === collectionName);
  if (!collection) throw httpError(404, `unknown collection "${collectionName}"`);
  const entry = collection.entries.find((e) => e.id === id);
  if (!entry) throw httpError(404, `no entry "${id}" in "${collectionName}"`);
  const abs = path.resolve(ctx.root, entry.file);
  const collectionDir = path.resolve(ctx.root, collection.dir);
  if (!isInside(collectionDir, abs)) throw httpError(400, "entry path escapes its collection");
  return { collection, entry, abs, collectionDir };
}

export async function readEntry(ctx, collectionName, id) {
  const { collection, entry, abs } = await resolveEntry(ctx, collectionName, id);
  const raw = await fs.readFile(abs, "utf8");
  const { frontmatter, body } = parseDocument(raw);
  return {
    collection: collection.name,
    id: entry.id,
    file: entry.file,
    folder: entry.folder,
    // Absolute dir of the entry; the client uses it to turn Vite's /@fs/ image
    // URLs back into the relative paths that belong in the Markdown.
    absDir: path.dirname(abs).split(path.sep).join("/"),
    mdx: isMdx(abs),
    frontmatter,
    body,
    ...splitBlocks(body, { mdx: isMdx(abs) }),
    hash: hashOf(raw),
    // Field definitions for the panel: from the Zod schema (via Astro's generated JSON Schema) or inferred from values.
    schema: await readCollectionSchema(ctx, collection),
  };
}

function isMdx(file) {
  return path.extname(file).toLowerCase() === ".mdx";
}

export async function writeEntry(ctx, { collection, id, frontmatter, body, baseHash, force }) {
  const { abs, entry } = await resolveEntry(ctx, collection, id);
  const current = await fs.readFile(abs, "utf8");
  if (!force && baseHash && hashOf(current) !== baseHash) {
    throw httpError(409, "file changed on disk since it was loaded");
  }
  const next = serializeDocument(frontmatter ?? {}, typeof body === "string" ? body : "");
  // Refuse what Astro would refuse, before anything touches the disk.
  const { issues } = await validateDocument(ctx, collection, next, { entryDir: path.dirname(abs) });
  if (issues.length) throw validationError(issues);
  const saved = parseDocument(next);
  const result = { file: entry.file, body: saved.body, ...splitBlocks(saved.body, { mdx: isMdx(abs) }) };
  if (next === current) return { ...result, hash: hashOf(current), changed: false };
  await fs.writeFile(abs, next, "utf8");
  return { ...result, hash: hashOf(next), changed: true };
}

/**
 * Build a frontmatter skeleton for a new entry. The collection's schema (when
 * Astro has written one) comes first: defaults and required fields in schema
 * order. Optional schema fields are left out — Astro treats them as absent,
 * and an invented `""` or `0` would fail `image()`, `reference()` or `.min()`.
 * Only keys the schema doesn't know are topped up from the existing entries,
 * so a collection without a schema still gets a sensible start.
 */
export async function inferFrontmatterTemplate(ctx, collection, collections) {
  const schema = await readCollectionSchema(ctx, collection);
  /** @type {Record<string, unknown>} */
  const template = templateFromSchema(schema);
  const known = new Set(schema?.source === "zod" ? schema.fields.map((f) => f.key) : []);

  // A required reference() has no valid placeholder in the abstract; the first
  // entry of the collection it points at is one.
  for (const field of schema?.source === "zod" ? schema.fields : []) {
    if (field.type !== "reference" || !field.required || "default" in field) continue;
    const target = (collections ?? []).find((c) => c.name === field.collection);
    const first = target?.entries?.[0]?.id;
    if (first) template[field.key] = first;
    else delete template[field.key];
  }
  // A required image() can't be invented either: leave it for the author.
  for (const field of schema?.source === "zod" ? schema.fields : []) {
    if (field.type === "image" && template[field.key] === "") delete template[field.key];
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const e of collection.entries.slice(0, 8)) {
    try {
      const { frontmatter } = parseDocument(await fs.readFile(path.resolve(ctx.root, e.file), "utf8"));
      for (const [key, value] of Object.entries(frontmatter)) {
        if (key in template || known.has(key)) continue;
        if (typeof value === "boolean") template[key] = false;
        else if (typeof value === "number") template[key] = 0;
        else if (Array.isArray(value)) template[key] = [];
        else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) template[key] = today;
        else if (typeof value === "string") template[key] = "";
        else if (value && typeof value === "object") template[key] = {};
      }
    } catch {
      /* skip */
    }
  }
  return template;
}

export async function createEntry(ctx, { collection: collectionName, slug, title, frontmatter }) {
  if (!isSafeSegment(slug) || slug !== slugify(slug)) throw httpError(400, "slug must be kebab-case");
  const collections = await discoverCollections(ctx);
  const collection = collections.find((c) => c.name === collectionName);
  if (!collection) throw httpError(404, `unknown collection "${collectionName}"`);
  if (collection.entries.some((e) => e.id === slug)) throw httpError(409, `"${slug}" already exists`);

  const collectionDir = path.resolve(ctx.root, collection.dir);
  const folderStyle =
    collection.entries.length > 0 &&
    collection.entries.filter((e) => e.folder).length * 2 >= collection.entries.length;

  const abs = folderStyle
    ? path.join(collectionDir, slug, "index.md")
    : path.join(collectionDir, `${slug}.md`);
  if (!isInside(collectionDir, abs)) throw httpError(400, "bad slug");

  const template = await inferFrontmatterTemplate(ctx, collection, collections);
  const data = { ...template, ...(frontmatter ?? {}) };
  if ("title" in template || !Object.keys(template).length) data.title = title || slug;
  else if (title) data.title = title;
  // Frontmatter `slug` overrides the id in Astro's glob loader; never copy it across.
  delete data.slug;

  const body = `Start writing…\n`;
  const document = serializeDocument(data, body);
  const { issues } = await validateDocument(ctx, collection.name, document, { entryDir: path.dirname(abs) });
  if (issues.length) throw validationError(issues);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, document, { encoding: "utf8", flag: "wx" });

  return {
    collection: collection.name,
    id: slug,
    file: path.relative(ctx.root, abs).split(path.sep).join("/"),
  };
}

/** Directory where images for an entry live (colocated next to the entry). */
function mediaDirFor(entryAbs, entry) {
  const dir = path.dirname(entryAbs);
  if (entry.folder) return dir;
  return path.join(dir, path.basename(entryAbs).replace(/\.[^.]+$/, ""));
}

export async function listMedia(ctx, collectionName, id) {
  const { abs, entry } = await resolveEntry(ctx, collectionName, id);
  const dir = mediaDirFor(abs, entry);
  let dirents = [];
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const entryDir = path.dirname(abs);
  return dirents
    .filter((d) => d.isFile() && IMAGE_EXTS.has(path.extname(d.name).toLowerCase()))
    .map((d) => {
      const file = path.join(dir, d.name);
      return {
        name: d.name,
        src: "./" + path.relative(entryDir, file).split(path.sep).join("/"),
        url: "/@fs" + file.split(path.sep).join("/"),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Save a dropped / pasted file for an entry.
 *
 * Images go next to the entry and are referenced as `./photo.png` — Astro's
 * Markdown pipeline resolves and optimises those. Videos can't live there:
 * Astro only collects Markdown *image* nodes, so a raw `<video src="./clip.mp4">`
 * would 404. They go under `public/media/<collection>/<id>/` and are referenced
 * by their public URL, which works in dev and in the build with no config.
 */
export async function saveMedia(ctx, collectionName, id, filename, buffer) {
  const { abs, entry, collection, collectionDir } = await resolveEntry(ctx, collectionName, id);
  const ext = path.extname(filename).toLowerCase();
  const kind = mediaKindOf(filename);
  if (!kind) throw httpError(415, `unsupported media type "${ext || filename}"`);

  const base = slugify(path.basename(filename, ext)) || kind;
  let dir;
  let describe;
  if (kind === "video") {
    const publicDir = path.resolve(ctx.root, ctx.publicDir ?? "public");
    const mediaRoot = path.join(publicDir, "media");
    dir = path.join(mediaRoot, collection.name, ...entry.id.split("/"));
    if (!isInside(mediaRoot, dir)) throw httpError(400, "bad media path");
    // `src` is the public URL that belongs in the Markdown; `url` previews the
    // file right away (Vite's public-file list only picks the write up a beat later).
    describe = (file) => ({
      src: "/" + path.relative(publicDir, file).split(path.sep).map(encodeURIComponent).join("/"),
      url: "/@fs" + file.split(path.sep).join("/"),
    });
  } else {
    dir = mediaDirFor(abs, entry);
    if (!isInside(collectionDir, dir) && dir !== collectionDir) throw httpError(400, "bad media path");
    describe = (file) => ({
      src: "./" + path.relative(path.dirname(abs), file).split(path.sep).join("/"),
      url: "/@fs" + file.split(path.sep).join("/"),
    });
  }
  await fs.mkdir(dir, { recursive: true });

  let candidate = `${base}${ext}`;
  for (let i = 2; await exists(path.join(dir, candidate)); i++) candidate = `${base}-${i}${ext}`;

  const file = path.join(dir, candidate);
  await fs.writeFile(file, buffer, { flag: "wx" });

  return {
    name: candidate,
    kind,
    ...describe(file),
    file: path.relative(ctx.root, file).split(path.sep).join("/"),
  };
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
