import fs from "node:fs/promises";
import path from "node:path";
import { discoverCollections, ENTRY_EXTS, hashOf } from "./content.js";

/**
 * Tell the toolbar when an entry file changes on disk behind its back — a save
 * in your editor, a `git checkout`, a formatter. Float's own writes are known
 * to the sync gate and skipped. The event goes over Vite's HMR socket:
 *
 *   `astro-float:file-changed` → `{ collection, id, hash }`
 *
 * `hash` is the same one `/entry` returns, so the client can tell whether the
 * copy it holds is stale.
 *
 * @param {import('vite').ViteDevServer} server
 * @param {{ root: string, contentDir: string, collections: Record<string, { dir?: string, route?: string }>, gate: { isOwnWrite(file: string): boolean }, logger: { debug(msg: string): void } }} ctx
 */
export function watchEntries(server, ctx) {
  const onChange = async (file) => {
    if (!ENTRY_EXTS.has(path.extname(file).toLowerCase())) return;
    if (ctx.gate.isOwnWrite(file)) return;
    try {
      const rel = path.relative(ctx.root, file).split(path.sep).join("/");
      const collections = await discoverCollections(ctx);
      for (const collection of collections) {
        const entry = collection.entries.find((e) => e.file === rel);
        if (!entry) continue;
        const raw = await fs.readFile(file, "utf8");
        server.ws.send({
          type: "custom",
          event: "astro-float:file-changed",
          data: { collection: collection.name, id: entry.id, hash: hashOf(raw) },
        });
        ctx.logger.debug(`file changed outside Float: ${rel}`);
        return;
      }
    } catch {
      /* the file may be gone already; nothing to announce */
    }
  };
  server.watcher.on("change", onChange);
  server.watcher.on("add", onChange);
}
