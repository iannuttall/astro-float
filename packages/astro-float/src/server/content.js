import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export const ENTRY_EXTS = new Set([".md", ".mdx", ".markdown"]);
export const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"]);

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
    frontmatter,
    body,
    hash: hashOf(raw),
  };
}

export async function writeEntry(ctx, { collection, id, frontmatter, body, baseHash, force }) {
  const { abs, entry } = await resolveEntry(ctx, collection, id);
  const current = await fs.readFile(abs, "utf8");
  if (!force && baseHash && hashOf(current) !== baseHash) {
    throw httpError(409, "file changed on disk since it was loaded");
  }
  const next = serializeDocument(frontmatter ?? {}, typeof body === "string" ? body : "");
  if (next === current) return { file: entry.file, hash: hashOf(current), changed: false };
  await fs.writeFile(abs, next, "utf8");
  return { file: entry.file, hash: hashOf(next), changed: true };
}

/**
 * Build a sensible frontmatter skeleton for a new entry by looking at what the
 * collection's existing entries use. Zod schemas in content.config.ts are not
 * consulted (yet) — this is inference, not validation.
 */
export async function inferFrontmatterTemplate(ctx, collection) {
  /** @type {Record<string, unknown>} */
  const template = {};
  const today = new Date().toISOString().slice(0, 10);
  for (const e of collection.entries.slice(0, 8)) {
    try {
      const { frontmatter } = parseDocument(await fs.readFile(path.resolve(ctx.root, e.file), "utf8"));
      for (const [key, value] of Object.entries(frontmatter)) {
        if (key in template) continue;
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

  const template = await inferFrontmatterTemplate(ctx, collection);
  const data = { ...template, ...(frontmatter ?? {}) };
  if ("title" in template || !Object.keys(template).length) data.title = title || slug;
  else if (title) data.title = title;
  // Frontmatter `slug` overrides the id in Astro's glob loader; never copy it across.
  delete data.slug;

  const body = `Start writing…\n`;
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, serializeDocument(data, body), { encoding: "utf8", flag: "wx" });

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

export async function saveMedia(ctx, collectionName, id, filename, buffer) {
  const { abs, entry } = await resolveEntry(ctx, collectionName, id);
  const ext = path.extname(filename).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) throw httpError(415, `unsupported image type "${ext || filename}"`);

  const base = slugify(path.basename(filename, ext)) || "image";
  const dir = mediaDirFor(abs, entry);
  await fs.mkdir(dir, { recursive: true });

  let candidate = `${base}${ext}`;
  for (let i = 2; await exists(path.join(dir, candidate)); i++) candidate = `${base}-${i}${ext}`;

  const file = path.join(dir, candidate);
  if (!isInside(path.dirname(abs), file) && path.dirname(file) !== path.dirname(abs)) {
    throw httpError(400, "bad media path");
  }
  await fs.writeFile(file, buffer, { flag: "wx" });

  return {
    name: candidate,
    src: "./" + path.relative(path.dirname(abs), file).split(path.sep).join("/"),
    url: "/@fs" + file.split(path.sep).join("/"),
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
