import fs from "node:fs/promises";
import path from "node:path";
import { createCollection } from "./collections.js";
import {
  createEntry,
  discoverCollections,
  httpError,
  listMedia,
  mediaKindOf,
  readEntry,
  resolveEntry,
  saveMedia,
  writeEntry,
} from "./content.js";
import { createBlockRenderer } from "./render.js";
import { readCollectionSchema } from "./schema.js";
import { validateDocument } from "./validate.js";

export const API_BASE = "/__float/api";

const LOOPBACK_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOOPBACK_ADDRS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Mount Float's JSON API on the Vite dev server.
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
export function attachFloatApi(server, ctx) {
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
    const url = new URL(req.url ?? "/", "http://float.local");
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

        const synced = ctx.gate.expectSync();
        const result = await writeEntry(ctx, payload);
        if (result.changed) {
          ctx.logger.info(`saved ${result.file}`);
          const ok = await synced;
          return json(res, 200, { ...result, synced: ok });
        }
        return json(res, 200, { ...result, synced: true });
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
        const synced = ctx.gate.expectSync(4000);
        const created = await createEntry(ctx, payload);
        ctx.logger.info(`created ${created.file}`);
        return json(res, 201, { ...created, synced: await synced });
      }

      if (method === "POST" && url.pathname === "/collections") {
        const payload = await readJson(req, 1024 * 1024);
        // A content.config change makes Astro re-sync every collection; give it room.
        const synced = ctx.gate.expectSync(8000);
        const created = await createCollection(ctx, payload);
        ctx.logger.info(
          `created collection ${created.collection} (${created.config.updated ? `wired ${created.config.file}` : created.config.note})`,
        );
        return json(res, 201, { ...created, synced: await synced });
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
        ctx.gate.quiet();
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

/** Localhost-only, same-origin-only, and mutations must be sent by our client. */
function guard(req, ctx) {
  if (!ctx.allowRemote) {
    const host = req.headers.host ?? "";
    const addr = req.socket?.remoteAddress ?? "";
    if (!LOOPBACK_HOSTS.test(host) || !LOOPBACK_ADDRS.has(addr)) {
      throw httpError(403, "astro-float only answers on localhost (set allowRemote to change)");
    }
  }
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") throw httpError(403, "cross-site request blocked");
  if (req.method !== "GET" && req.headers["x-astro-float"] !== "1") throw httpError(403, "missing x-astro-float header");
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
