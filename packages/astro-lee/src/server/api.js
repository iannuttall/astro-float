import fs from "node:fs/promises";
import path from "node:path";
import { invalidateAssetImports, pruneAssetImports } from "./assets.js";
import { createCollection, deleteCollection } from "./collections.js";
import {
  createEntry,
  deleteEntry,
  discoverCollections,
  httpError,
  listMedia,
  mediaKindOf,
  readEntry,
  renameEntry,
  resolveEntry,
  saveMedia,
  writeEntry,
} from "./content.js";
import { createBlockRenderer } from "./render.js";
import { readCollectionSchema } from "./schema.js";
import { validateDocument } from "./validate.js";

export const API_BASE = "/__lee/api";

const LOOPBACK_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOOPBACK_ADDRS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Mount Lee's JSON API on the Vite dev server.
 *
 * @param {import('vite').ViteDevServer} server
 * @param {{
 *   root: string,
 *   server: import('vite').ViteDevServer,
 *   contentDir: string,
 *   collections: Record<string, { dir?: string, route?: string }>,
 *   allowRemote: boolean,
 *   maxUploadBytes: number,
 *   maxVideoBytes: number,
 *   publicDir?: string,
 *   markdown?: Record<string, unknown>,
 *   gate: ReturnType<import('./sync-gate.js').createSyncGate>,
 *   logger: import('astro').AstroIntegrationLogger,
 * }} ctx
 */
export function attachLeeApi(server, ctx) {
  const renderer = createBlockRenderer(ctx);
  // The render endpoint fires on a typing debounce; remember where the entry
  // lives for a moment instead of walking the collection on every call.
  /** @type {Map<string, { at: number, mdx: boolean, absDir: string }>} */
  const located = new Map();
  const LOCATE_TTL_MS = 10_000;
  const locate = async (collection, id) => {
    const key = `${collection}\u0000${id}`;
    const hit = located.get(key);
    if (hit && Date.now() - hit.at < LOCATE_TTL_MS) return hit;
    const { abs } = await resolveEntry(ctx, collection, id);
    const found = { at: Date.now(), mdx: path.extname(abs).toLowerCase() === ".mdx", absDir: path.dirname(abs).split(path.sep).join("/") };
    located.set(key, found);
    return found;
  };

  server.middlewares.use(API_BASE, async (req, res) => {
    const url = new URL(req.url ?? "/", "http://lee.local");
    const method = req.method ?? "GET";

    try {
      guard(req, ctx);
      ctx.gate.touch();

      if (method === "POST" && url.pathname === "/session") {
        const payload = await readJson(req, 4096);
        ctx.gate.session(payload.editing === true);
        return json(res, 200, { editing: ctx.gate.isEditing() });
      }

      if (method === "GET" && url.pathname === "/collections") {
        return json(res, 200, { collections: await discoverCollections(ctx) });
      }

      if (method === "GET" && url.pathname === "/schema") {
        const { collection: name } = requireParams(url, ["collection"]);
        const collection = (await discoverCollections(ctx)).find((c) => c.name === name);
        if (!collection) throw httpError(404, `unknown collection "${name}"`);
        return json(res, 200, await readCollectionSchema(ctx, collection));
      }

      if (method === "GET" && url.pathname === "/diagnose") {
        const { collection: name } = requireParams(url, ["collection"]);
        const id = url.searchParams.get("id");
        const collection = (await discoverCollections(ctx)).find((c) => c.name === name);
        if (!collection) throw httpError(404, `unknown collection "${name}"`);
        const entries = id ? collection.entries.filter((e) => e.id === id) : collection.entries;
        if (id && !entries.length) throw httpError(404, `no entry "${id}" in "${name}"`);
        const reports = [];
        let schema = "inferred";
        let strict = false;
        for (const entry of entries) {
          const abs = path.resolve(ctx.root, entry.file);
          const report = await validateDocument(ctx, name, await fs.readFile(abs, "utf8"), { entryDir: path.dirname(abs) });
          schema = report.schema;
          strict = report.strict;
          reports.push({ id: entry.id, file: entry.file, issues: report.issues });
        }
        if (!entries.length) {
          const empty = await validateDocument(ctx, name, "---\n---\n");
          schema = empty.schema;
          strict = empty.strict;
        }
        if (id) return json(res, 200, { schema, strict, issues: reports[0].issues });
        return json(res, 200, { schema, strict, entries: reports });
      }

      if (method === "GET" && url.pathname === "/entry") {
        const { collection, id } = requireParams(url, ["collection", "id"]);
        return json(res, 200, await readEntry(ctx, collection, id));
      }

      if (method === "PUT" && url.pathname === "/entry") {
        const payload = await readJson(req, 5 * 1024 * 1024);
        const { collection, id } = payload;
        if (typeof collection !== "string" || typeof id !== "string") throw httpError(400, "collection and id required");

        const operation = await ctx.gate.begin(`the save of ${collection}/${id}`);
        try {
          const result = await writeEntry(ctx, payload);
          if (!result.changed) {
            operation.cancel();
            return json(res, 200, { ...result, synced: true });
          }
          ctx.logger.info(`saved ${result.file}`);
          await operation.waitFor({ type: "entry", collection, id, file: result.file });
          operation.cancel();
          return json(res, 200, { ...result, synced: true });
        } catch (err) {
          operation.cancel();
          throw err;
        }
      }

      if (method === "DELETE" && url.pathname === "/entry") {
        const { collection, id } = requireParams(url, ["collection", "id"]);
        const operation = await ctx.gate.begin(`the delete of ${collection}/${id}`);
        try {
          const deleted = await deleteEntry(ctx, collection, id);
          located.delete(`${collection}\u0000${id}`);
          ctx.logger.info(`deleted ${deleted.file}`);
          await cleanAssetMap(ctx, "before syncing the delete");
          await operation.waitFor({ type: "entry-absent", collection, id });
          operation.cancel();
          return json(res, 200, { ...deleted, synced: true });
        } catch (err) {
          operation.cancel();
          throw err;
        }
      }

      if (method === "DELETE" && url.pathname === "/collection") {
        const { name } = requireParams(url, ["name"]);
        const operation = await ctx.gate.begin(`the delete of collection ${name}`);
        try {
          const deleted = await deleteCollection(ctx, name);
          located.clear();
          ctx.logger.info(`deleted collection ${name} (${deleted.config.updated ? `unwired ${deleted.config.file}` : deleted.config.note})`);
          await cleanAssetMap(ctx, "before syncing the delete");
          await operation.waitFor({ type: "collection-absent", collection: name });
          operation.cancel();
          return json(res, 200, { ...deleted, synced: true });
        } catch (err) {
          operation.cancel();
          throw err;
        }
      }

      if (method === "POST" && url.pathname === "/rename") {
        const payload = await readJson(req, 4096);
        const { collection, id } = payload;
        if (typeof collection !== "string" || typeof id !== "string") throw httpError(400, "collection and id required");
        const operation = await ctx.gate.begin(`the rename of ${collection}/${id}`);
        try {
          const renamed = await renameEntry(ctx, payload);
          located.delete(`${collection}\u0000${id}`);
          if (!renamed.changed) {
            operation.cancel();
            return json(res, 200, { ...renamed, synced: true });
          }
          ctx.logger.info(`renamed ${collection}/${id} → ${renamed.file}`);
          // A folder move is an unlink plus add. Astro's glob loader handles
          // the add directly and writes the new image imports. A forced full
          // refresh would evaluate the old map while its files are moving.
          await operation.waitFor(
            { type: "entry", collection, id: renamed.id, file: renamed.file, oldId: id },
            { refresh: false },
          );
          await cleanAssetMap(ctx, "after syncing the move");
          operation.cancel();
          return json(res, 200, { ...renamed, synced: true });
        } catch (err) {
          operation.cancel();
          throw err;
        }
      }

      if (method === "POST" && url.pathname === "/render") {
        const payload = await readJson(req, 5 * 1024 * 1024);
        const { collection, id, body } = payload;
        if (typeof collection !== "string" || typeof id !== "string") throw httpError(400, "collection and id required");
        if (typeof body !== "string") throw httpError(400, "body must be a string");
        const { mdx, absDir } = await locate(collection, id);
        return json(res, 200, { blocks: await renderer.render(body, { mdx, absDir }) });
      }

      if (method === "POST" && url.pathname === "/entries") {
        const payload = await readJson(req, 1024 * 1024);
        const operation = await ctx.gate.begin(`the creation of ${payload.collection}/${payload.slug}`);
        try {
          const created = await createEntry(ctx, payload);
          ctx.logger.info(`created ${created.file}`);
          await operation.waitFor({ type: "entry", collection: created.collection, id: created.id, file: created.file });
          operation.cancel();
          return json(res, 201, { ...created, synced: true });
        } catch (err) {
          operation.cancel();
          throw err;
        }
      }

      if (method === "POST" && url.pathname === "/collections") {
        const payload = await readJson(req, 1024 * 1024);
        const operation = await ctx.gate.begin(`the creation of collection ${payload.name}`);
        try {
          const created = await createCollection(ctx, payload);
          ctx.logger.info(
            `created collection ${created.collection} (${created.config.updated ? `wired ${created.config.file}` : created.config.note})`,
          );
          await operation.waitFor({ type: "entry", collection: created.collection, id: created.id, file: created.file });
          operation.cancel();
          return json(res, 201, { ...created, synced: true });
        } catch (err) {
          operation.cancel();
          throw err;
        }
      }

      if (method === "POST" && url.pathname === "/sync") {
        const operation = await ctx.gate.begin("the requested content refresh", { requireChange: false });
        try {
          await operation.waitFor({ type: "content-snapshot", contentDir: ctx.contentDir });
          operation.cancel();
          return json(res, 200, { synced: true });
        } catch (err) {
          operation.cancel();
          throw err;
        }
      }

      if (method === "GET" && url.pathname === "/media") {
        const { collection, id } = requireParams(url, ["collection", "id"]);
        return json(res, 200, { media: await listMedia(ctx, collection, id) });
      }

      if (method === "POST" && url.pathname === "/media") {
        const { collection, id, name } = requireParams(url, ["collection", "id", "name"]);
        const kind = mediaKindOf(name);
        if (!kind) throw httpError(415, `unsupported media type "${name}"`);
        const buffer = await readRaw(req, kind === "video" ? ctx.maxVideoBytes : ctx.maxUploadBytes);
        if (!buffer.length) throw httpError(400, "empty upload");
        const saved = await saveMedia(ctx, collection, id, name, buffer);
        ctx.logger.info(`saved ${kind} ${saved.file}`);
        return json(res, 201, saved);
      }

      throw httpError(404, "not found");
    } catch (err) {
      const status = typeof err?.status === "number" ? err.status : 500;
      if (status >= 500) ctx.logger.error(err?.stack ?? String(err));
      const body = { error: err?.message ?? "unknown error" };
      if (Array.isArray(err?.issues)) body.issues = err.issues;
      return json(res, status, body);
    }
  });
}

/** Images that moved or went away with an entry: take them out of Astro's import map, and have Vite load the map afresh before the next page is asked for. */
async function cleanAssetMap(ctx, when) {
  try {
    const dropped = await pruneAssetImports(ctx);
    if (dropped.length) ctx.logger.debug(`dropped ${dropped.length} stale asset import(s) ${when}`);
  } catch (err) {
    ctx.logger.warn(`couldn't clean .astro/content-assets.mjs ${when} (${err?.message ?? err}); restart astro dev if pages 500`);
  }
  invalidateAssetImports(ctx.server, ctx.root);
}

/** Localhost-only, same-origin-only, and mutations must be sent by our client. */
function guard(req, ctx) {
  if (!ctx.allowRemote) {
    const host = req.headers.host ?? "";
    const addr = req.socket?.remoteAddress ?? "";
    if (!LOOPBACK_HOSTS.test(host) || !LOOPBACK_ADDRS.has(addr)) {
      throw httpError(403, "astro-lee only answers on localhost (set allowRemote to change)");
    }
  }
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") throw httpError(403, "cross-site request blocked");
  if (req.method !== "GET" && req.headers["x-lee"] !== "1") throw httpError(403, "missing x-lee header");
}

function requireParams(url, names) {
  const out = {};
  for (const n of names) {
    const v = url.searchParams.get(n);
    if (!v) throw httpError(400, `missing "${n}"`);
    out[n] = v;
  }
  return out;
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(httpError(413, `payload exceeds ${Math.round(limit / 1024 / 1024)}MB`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req, limit) {
  const raw = await readRaw(req, limit);
  try {
    const data = JSON.parse(raw.toString("utf8") || "{}");
    if (!data || typeof data !== "object") throw new Error();
    return data;
  } catch {
    throw httpError(400, "invalid JSON body");
  }
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
