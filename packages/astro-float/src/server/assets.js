import fs from "node:fs/promises";
import path from "node:path";

/**
 * Astro's content layer keeps every image an entry ever referenced in
 * `.astro/content-assets.mjs`, as `import` lines keyed by the image path and
 * the entry that imported it. The set only grows: when a file it names goes
 * away — an entry folder renamed, an image deleted — the module fails to load
 * and every page answers 500 until `astro dev` is restarted.
 *
 * Float moves folders, so after each move (and whenever Astro rewrites the
 * file, which puts the stale lines back) it drops the imports whose entry or
 * image no longer exists. Vite sees the rewrite and reloads the module.
 */
const ASSETS_FILE = path.join(".astro", "content-assets.mjs");
const IMPORT_LINE = /^import (\S+) from ("(?:[^"\\]|\\.)*");\n/gm;

/** Path of the asset map for a project root. */
export function assetImportsFile(root) {
  return path.join(root, ASSETS_FILE);
}

/** Prunes run one at a time: the rename endpoint and the file watcher both ask, often at once. */
let queue = Promise.resolve();
let serial = 0;

/**
 * Drop stale imports from the asset map. Returns the ids removed (empty when
 * the file is missing, has another shape, or is clean).
 * @param {{ root: string }} ctx
 * @returns {Promise<string[]>}
 */
export function pruneAssetImports(ctx) {
  const run = queue.then(() => prune(ctx));
  queue = run.catch(() => {});
  return run;
}

async function prune(ctx) {
  const file = assetImportsFile(ctx.root);
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return [];
  }
  /** @type {Array<{ symbol: string, id: string, quoted: string }>} */
  const stale = [];
  for (const m of text.matchAll(IMPORT_LINE)) {
    let id;
    try {
      id = JSON.parse(m[2]);
    } catch {
      continue;
    }
    if (await isStale(ctx.root, id)) stale.push({ symbol: m[1], id, quoted: m[2] });
  }
  if (!stale.length) return [];

  let next = text;
  for (const { symbol, quoted } of stale) {
    next = next.replace(`import ${symbol} from ${quoted};\n`, "");
    next = next.replace(`[${quoted}, ${symbol}]`, "");
  }
  // The Map's array with the entries taken out: no dangling commas.
  next = next.replace(/new Map\(\[([\s\S]*?)\]\)/, (_, inner) => `new Map([${inner.split(",").map((s) => s.trim()).filter(Boolean).join(", ")}])`);
  // Atomic, like Astro's own write: no half-written module for Vite to load.
  const tmp = `${file}.float-${process.pid}-${++serial}.tmp`;
  await fs.writeFile(tmp, next, "utf8");
  await fs.rename(tmp, file);
  return stale.map((s) => s.id);
}

/**
 * An import id is `<src>?astroContentImageFlag=&importer=<entry file>`. It's
 * stale when the entry is gone, or when a relative `src` no longer resolves
 * next to it. Anything else (a remote URL, an alias) is left alone.
 */
async function isStale(root, id) {
  const q = id.indexOf("?");
  if (q === -1) return false;
  const src = id.slice(0, q);
  const params = new URLSearchParams(id.slice(q + 1));
  if (!params.has("astroContentImageFlag")) return false;
  const importer = params.get("importer");
  if (!importer) return false;
  const importerAbs = path.resolve(root, importer);
  if (!(await exists(importerAbs))) return true;
  if (src.startsWith("./") || src.startsWith("../")) return !(await exists(path.resolve(path.dirname(importerAbs), src)));
  return false;
}

/**
 * Keep the map clean for the rest of the session: Astro rewrites it from
 * memory (stale lines included) whenever a new image is imported.
 * @param {import('vite').ViteDevServer} server
 * @param {{ root: string, logger: { debug(msg: string): void } }} ctx
 */
export function watchAssetImports(server, ctx) {
  const file = assetImportsFile(ctx.root);
  const onChange = async (changed) => {
    if (changed !== file) return;
    try {
      const removed = await pruneAssetImports(ctx);
      if (removed.length) ctx.logger.debug(`dropped ${removed.length} stale asset import(s) from ${ASSETS_FILE}`);
    } catch {
      /* the next rewrite gets another go */
    }
  };
  server.watcher.on("change", onChange);
  server.watcher.on("add", onChange);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
