import fs from "node:fs/promises";
import path from "node:path";

/**
 * Astro's content layer keeps every image an entry ever referenced in
 * `.astro/content-assets.mjs`, as `import` lines keyed by the image path and
 * the entry that imported it. The set only grows: when a file it names goes
 * away — an entry folder renamed, an image deleted — the module fails to load
 * and every page answers 500 until `astro dev` is restarted.
 *
 * Lee moves folders, so after each move (and whenever Astro rewrites the
 * file, which puts the stale lines back) it drops the imports whose entry or
 * image no longer exists, and has Vite load the module afresh.
 *
 * Astro writes this map on a 500ms debounce of its own, after the entry store
 * save that Lee counts as "synced". A page rendered in between has no import
 * for a just-moved image, and Astro leaves that image as a bare
 * `<img __ASTRO_IMAGE_…>` placeholder. So a move also waits for that write
 * (`waitForAssetImports`) before it answers. And when `.astro` was empty at
 * start-up, Astro renders from a virtual copy of the map that no watcher
 * reloads, so every write is followed by an invalidation.
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

/**
 * How many images the map imports for `entryFile` (project-relative, as
 * `discoverCollections` names it); 0 without a map. The map never forgets an
 * image, so pass the entry's text as `linkedFrom` to count only the images it
 * still links to.
 * @param {{ root: string }} ctx
 * @param {string} entryFile
 * @param {string} [linkedFrom]
 * @returns {Promise<number>}
 */
export async function countAssetImports(ctx, entryFile, linkedFrom) {
  let text;
  try {
    text = await fs.readFile(assetImportsFile(ctx.root), "utf8");
  } catch {
    return 0;
  }
  const want = path.resolve(ctx.root, entryFile);
  let count = 0;
  for (const m of text.matchAll(IMPORT_LINE)) {
    let id;
    try {
      id = JSON.parse(m[2]);
    } catch {
      continue;
    }
    const importer = importerOf(id);
    if (!importer || path.resolve(ctx.root, importer) !== want) continue;
    if (linkedFrom === undefined || linkedFrom.includes(id.slice(0, id.indexOf("?")))) count++;
  }
  return count;
}

/**
 * Wait until the map imports at least `count` images for `entryFile` (Astro's
 * debounced write after a move), or `timeoutMs` passes. True when it does.
 * @param {{ root: string }} ctx
 * @param {string} entryFile
 * @param {number} count
 * @returns {Promise<boolean>}
 */
export async function waitForAssetImports(ctx, entryFile, count, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await countAssetImports(ctx, entryFile)) >= count) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * What `astro:asset-imports` resolves to when the map file isn't there yet (a
 * cold `.astro` at start-up): a virtual copy of the file, loaded once, that no
 * file watcher ever reloads.
 */
const ASSET_IMPORTS_STUB_ID = `${String.fromCharCode(0)}astro:asset-imports`;

/**
 * Have Vite load the map from disk for the next render: invalidate its module
 * (the file, or the virtual copy Astro resolved to at start-up) in every
 * environment's graph, in a module runner that has already run it (Astro 6+
 * renders through one) and in the legacy graph. Astro 7 does this for the file
 * after its own writes; Astro 5 and 6 leave it to the file watcher, which is
 * late, and nothing reloads the virtual copy.
 * @param {any} server the Vite dev server
 * @param {string} root
 */
export function invalidateAssetImports(server, root) {
  const file = assetImportsFile(root).split(path.sep).join("/");
  const find = (graph) => [...(graph?.getModulesByFile?.(file) ?? []), graph?.getModuleById?.(ASSET_IMPORTS_STUB_ID)].filter(Boolean);
  const timestamp = Date.now();
  for (const environment of Object.values(server?.environments ?? {})) {
    const graph = environment?.moduleGraph;
    for (const mod of find(graph)) graph.invalidateModule(mod, undefined, timestamp, true);
    // `_runner`, not `runner`: the getter would create a runner Astro 5 never uses.
    const evaluated = environment?._runner?.evaluatedModules;
    for (const mod of find(evaluated)) evaluated.invalidateModule(mod);
  }
  const legacy = server?.moduleGraph;
  for (const mod of find(legacy)) legacy.invalidateModule(mod);
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
  const tmp = `${file}.lee-${process.pid}-${++serial}.tmp`;
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
  const importer = importerOf(id);
  if (!importer) return false;
  const src = id.slice(0, id.indexOf("?"));
  const importerAbs = path.resolve(root, importer);
  if (!(await exists(importerAbs))) return true;
  if (src.startsWith("./") || src.startsWith("../")) return !(await exists(path.resolve(path.dirname(importerAbs), src)));
  return false;
}

/** The entry file (project-relative) an import id belongs to; null for anything that isn't a content image import. */
function importerOf(id) {
  const q = id.indexOf("?");
  if (q === -1) return null;
  const params = new URLSearchParams(id.slice(q + 1));
  return params.has("astroContentImageFlag") ? params.get("importer") || null : null;
}

/**
 * Keep the map clean for the rest of the session: Astro rewrites it from
 * memory (stale lines included) whenever a new image is imported.
 * @param {import('vite').ViteDevServer} server
 * @param {{ root: string, logger: { debug(msg: string): void } }} ctx
 */
export function watchAssetImports(server, ctx) {
  const file = assetImportsFile(ctx.root);
  // Not every Astro has `.astro/` watched; this file has to be.
  server.watcher.add(file);
  const onChange = async (changed) => {
    if (changed !== file) return;
    try {
      const removed = await pruneAssetImports(ctx);
      if (removed.length) ctx.logger.debug(`dropped ${removed.length} stale asset import(s) from ${ASSETS_FILE}`);
    } catch {
      /* the next rewrite gets another go */
    }
    // After every write, not only a prune: nothing else reloads the virtual copy Astro may be rendering from.
    invalidateAssetImports(server, ctx.root);
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
